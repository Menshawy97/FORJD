import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  decidePush,
  PUSH_MAX_AGE_MS,
  type PushContent,
  type PushDropReason,
  type PushKind,
  type QuietHours,
} from '@forjd/domain';

import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
  type PushMessage,
  type PushTicket,
} from '../integrations/push/notification-provider';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { PushOutboxRepository, type OutboxRow } from './push-outbox.repository';
import { PushTokensRepository } from './push-tokens.repository';

/** Five tries, then it is marked failed: 5, 10, 20 and 40 minutes between them. */
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 5 * 60_000;
/** A row `sending` for longer than this belongs to a dispatcher that died and is taken back. */
const CLAIM_STALE_MS = 10 * 60_000;
/** Expo asks for receipts to be read about a quarter of an hour after sending, and keeps them for a day. */
const RECEIPT_DELAY_MS = 15 * 60_000;
const TICKET_KEEP_MS = 24 * 3_600_000;
/** Finished rows are kept for a month, for support and for the person's export, then purged. */
const RETENTION_MS = 30 * 24 * 3_600_000;
const DISPATCH_BATCH = 100;
const RECEIPT_BATCH = 1000;
/** The Android channel the phone creates for these pushes (slice 4). */
const PUSH_CHANNEL_ID = 'updates';
const MIN_TTL_SECONDS = 60;

export interface EnqueueInput {
  userId: string;
  kind: PushKind;
  /** Makes this push the same push if it is queued twice, e.g. `pr:<sessionId>` or `rank:<weekStart>:<user>`. */
  dedupeKey: string;
  /** Built by one of the builders in `@forjd/domain` (ADR-061), never by hand. */
  content: PushContent;
  occurredAt: Date;
  now?: Date;
}

export type EnqueueResult =
  | { result: 'queued' }
  | { result: 'duplicate' }
  | { result: 'dropped'; reason: PushDropReason };

export interface DispatchSummary {
  claimed: number;
  sent: number;
  dropped: number;
  /** Put back for later, outside quiet hours. */
  held: number;
  /** Put back because the service could not take it, to try again with backoff. */
  retried: number;
  failed: number;
}

export interface ReceiptSummary {
  /** Tickets the service answered. */
  checked: number;
  /** Phones removed because a receipt said the device is gone. */
  removedTokens: number;
  /** Tickets given up on because the service never answered in a day. */
  expired: number;
}

interface Recipient {
  pr: boolean;
  rank: boolean;
  quietHours: QuietHours;
  timeZone: string | null;
  phones: Array<{ id: string; token: string }>;
}

/**
 * Queues pushes and sends them (Phase 12F, ADR-065). Senders (the PR sender at upload, the snapshot script) call `enqueue`;
 * a small workflow calls `drain`. Every decision is `decidePush` in `@forjd/domain`, taken twice: when queueing, and again
 * at the moment of sending, because the person may have changed a switch or quiet hours in between.
 *
 * Delivery is at-least-once: a push is queued once (the dedupe key), claimed by one dispatcher at a time, and retried only
 * when the service could not take it. Never logs a push token.
 */
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(
    private readonly outbox: PushOutboxRepository,
    private readonly tokens: PushTokensRepository,
    private readonly preferences: NotificationPreferencesRepository,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
  ) {}

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const now = input.now ?? new Date();
    const recipient = await this.recipientOf(input.userId);
    const decision = decidePush({
      kind: input.kind,
      switchOn: recipient[input.kind],
      hasToken: recipient.phones.length > 0,
      quietHours: recipient.quietHours,
      timeZone: recipient.timeZone,
      now,
      occurredAt: input.occurredAt,
    });
    if (decision.action === 'drop') return { result: 'dropped', reason: decision.reason };

    const queued = await this.outbox.enqueue({
      userId: input.userId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      title: input.content.title,
      body: input.content.body,
      data: input.content.data,
      occurredAt: input.occurredAt,
      sendAfter: decision.action === 'send_at' ? decision.at : now,
    });
    return queued ? { result: 'queued' } : { result: 'duplicate' };
  }

  /** Sends what is due. One push failing never stops the others: it is put back with backoff, and logged without its token. */
  async dispatchDue(now: Date = new Date(), limit: number = DISPATCH_BATCH): Promise<DispatchSummary> {
    const claimed = await this.outbox.claimDue(now, limit, new Date(now.getTime() - CLAIM_STALE_MS));
    const summary: DispatchSummary = { claimed: claimed.length, sent: 0, dropped: 0, held: 0, retried: 0, failed: 0 };
    for (const row of claimed) {
      try {
        await this.dispatchRow(row, now, summary);
      } catch (error) {
        // An unexpected failure must not leave the row `sending` until it goes stale: put it back, counted as a try.
        this.logger.error(`Dispatching push ${row.id} failed (${error instanceof Error ? error.name : 'unknown error'}).`);
        await this.retryOrFail(row, now, summary);
      }
    }
    return summary;
  }

  /** Reads the receipts of pushes sent a quarter of an hour ago, and removes phones the service says are gone. */
  async checkReceipts(now: Date = new Date()): Promise<ReceiptSummary> {
    const due = await this.outbox.dueTickets(new Date(now.getTime() - RECEIPT_DELAY_MS), RECEIPT_BATCH);
    const summary: ReceiptSummary = { checked: 0, removedTokens: 0, expired: 0 };

    if (due.length > 0) {
      const receipts = await this.provider.receipts([...new Set(due.map((ticket) => ticket.ticketId))]);
      const byTicket = new Map(receipts.map((receipt) => [receipt.ticketId, receipt]));
      const answered: string[] = [];
      const goneTokenIds = new Set<string>();
      for (const ticket of due) {
        const receipt = byTicket.get(ticket.ticketId);
        if (!receipt) continue;
        answered.push(ticket.id);
        if (receipt.status === 'error' && receipt.error === 'device_not_registered') goneTokenIds.add(ticket.deviceTokenId);
      }
      if (goneTokenIds.size > 0) await this.tokens.deleteByIds([...goneTokenIds]);
      await this.outbox.markTicketsChecked(answered, now);
      summary.checked = answered.length;
      summary.removedTokens = goneTokenIds.size;
    }

    summary.expired = await this.outbox.expireTickets(new Date(now.getTime() - TICKET_KEEP_MS), now);
    return summary;
  }

  /** Everything the workflow does each time it runs: send what is due, read receipts, tidy up. */
  async drain(now: Date = new Date()): Promise<{ dispatched: DispatchSummary; receipts: ReceiptSummary; purged: number }> {
    // The three steps are independent: one failing is logged and does not stop the others or lose their results.
    const dispatched = await this.step('dispatch', () => this.dispatchDue(now), { claimed: 0, sent: 0, dropped: 0, held: 0, retried: 0, failed: 0 });
    const receipts = await this.step('receipts', () => this.checkReceipts(now), { checked: 0, removedTokens: 0, expired: 0 });
    const purged = await this.step('purge', () => this.outbox.purge(new Date(now.getTime() - RETENTION_MS)), 0);
    return { dispatched, receipts, purged };
  }

  private async step<T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.logger.error(`Push drain step "${name}" failed (${error instanceof Error ? error.name : 'unknown error'}).`);
      return fallback;
    }
  }

  private async recipientOf(userId: string): Promise<Recipient> {
    const [{ preferences, quietHours }, phones, timeZone] = await Promise.all([
      this.preferences.get(userId),
      this.tokens.listForUser(userId),
      this.outbox.timeZoneOf(userId),
    ]);
    return {
      pr: preferences.pr,
      rank: preferences.rank,
      quietHours,
      timeZone,
      phones: phones.map((phone) => ({ id: phone.id, token: phone.token })),
    };
  }

  private async dispatchRow(row: OutboxRow, now: Date, summary: DispatchSummary): Promise<void> {
    // A row that keeps being taken back from dispatchers that died is not sent again: it has used its tries.
    if (row.attempts >= MAX_ATTEMPTS) {
      await this.outbox.markFailed(row.id);
      summary.failed += 1;
      return;
    }
    // Rows are handled one after another, so a long batch must not look abandoned to another dispatcher: renew the claim.
    // The later of the dispatcher's clock and the wall clock: the same instant in production, and consistent under a test clock.
    await this.outbox.touchClaim(row.id, new Date(Math.max(now.getTime(), Date.now())));
    const kind = row.kind as PushKind;
    const recipient = await this.recipientOf(row.userId);
    // Decided again now: a switch, quiet hours or a phone may have changed since the push was queued.
    const decision = decidePush({
      kind,
      switchOn: recipient[kind],
      hasToken: recipient.phones.length > 0,
      quietHours: recipient.quietHours,
      timeZone: recipient.timeZone,
      now,
      occurredAt: row.occurredAt,
    });
    if (decision.action === 'drop') {
      await this.outbox.markDropped(row.id, decision.reason);
      summary.dropped += 1;
      return;
    }
    if (decision.action === 'send_at') {
      await this.outbox.release(row.id, decision.at, false);
      summary.held += 1;
      return;
    }

    const ttlSeconds = Math.max(MIN_TTL_SECONDS, Math.floor((PUSH_MAX_AGE_MS[kind] - (now.getTime() - row.occurredAt.getTime())) / 1000));
    const messages: PushMessage[] = recipient.phones.map((phone) => ({
      token: phone.token,
      title: row.title,
      body: row.body,
      data: row.data,
      channelId: PUSH_CHANNEL_ID,
      priority: 'high',
      ttlSeconds,
    }));
    const tickets = await this.provider.send(messages);
    const idOf = new Map(recipient.phones.map((phone) => [phone.token, phone.id]));

    const accepted = tickets.filter((ticket): ticket is Extract<PushTicket, { status: 'ok' }> => ticket.status === 'ok');
    await this.recordOutcome(row, now, tickets, accepted, idOf);
    if (accepted.length > 0) {
      summary.sent += 1;
      return;
    }

    if (tickets.some((ticket) => ticket.status === 'error' && ticket.retryable)) {
      await this.retryOrFail(row, now, summary);
    } else if (tickets.every((ticket) => ticket.status === 'error' && ticket.error === 'device_not_registered')) {
      await this.outbox.markDropped(row.id, 'no_token');
      summary.dropped += 1;
    } else {
      await this.outbox.markFailed(row.id);
      summary.failed += 1;
    }
  }

  /**
   * Records what the service said, once it has said it. From the moment `send` has returned the push may already be on a
   * phone, so nothing here may throw out of `dispatchRow`: that would put the row back and send it again. Each step is best
   * effort and logged without a token. (A crash between the send and `markSent` still leaves the row `sending` until it is
   * taken back, and sends again: Expo has no idempotency key, so that window is accepted, see ADR-065.)
   */
  private async recordOutcome(
    row: OutboxRow,
    now: Date,
    tickets: readonly PushTicket[],
    accepted: ReadonlyArray<Extract<PushTicket, { status: 'ok' }>>,
    idOf: ReadonlyMap<string, string>,
  ): Promise<void> {
    const goneIds = tickets
      .filter((ticket) => ticket.status === 'error' && ticket.error === 'device_not_registered')
      .map((ticket) => idOf.get(ticket.token))
      .filter((id): id is string => id !== undefined);
    await this.bestEffort(row, 'remove a phone the service reported gone', () => this.tokens.deleteByIds(goneIds));

    if (accepted.length === 0) return;
    // One ticket at a time: a phone unregistered since the send would fail a batch insert and lose the others.
    for (const ticket of accepted) {
      const deviceTokenId = idOf.get(ticket.token);
      if (!deviceTokenId) continue;
      await this.bestEffort(row, 'keep a ticket', () =>
        this.outbox.addTickets([{ outboxId: row.id, deviceTokenId, ticketId: ticket.ticketId, createdAt: now }]),
      );
    }
    await this.bestEffort(row, 'mark the push sent', () => this.outbox.markSent(row.id, now));
  }

  private async bestEffort(row: OutboxRow, what: string, step: () => Promise<unknown>): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.logger.error(`Push ${row.id}: could not ${what} after sending (${error instanceof Error ? error.name : 'unknown error'}).`);
    }
  }

  private async retryOrFail(row: OutboxRow, now: Date, summary: DispatchSummary): Promise<void> {
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await this.outbox.markFailed(row.id);
      summary.failed += 1;
      return;
    }
    await this.outbox.release(row.id, new Date(now.getTime() + BACKOFF_BASE_MS * 2 ** row.attempts), true);
    summary.retried += 1;
  }
}
