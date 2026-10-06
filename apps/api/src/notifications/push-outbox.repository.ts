import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { preferences } from '../database/schema/preferences.schema';
import { pushOutbox, PushOutboxRow, pushTickets } from '../database/schema/push-outbox.schema';

export type OutboxRow = PushOutboxRow;

export interface NewOutboxEntry {
  userId: string;
  kind: 'pr' | 'rank';
  /** Makes this push the same push if it is queued twice. */
  dedupeKey: string;
  title: string;
  body: string;
  data: Record<string, string>;
  occurredAt: Date;
  sendAfter: Date;
}

export interface NewTicket {
  outboxId: string;
  deviceTokenId: string;
  ticketId: string;
  /** Defaults to now; the dispatcher passes its own clock so receipts are read a quarter of an hour after sending. */
  createdAt?: Date;
}

export interface DueTicket {
  id: string;
  ticketId: string;
  deviceTokenId: string;
}

/** The raw row a `returning *` statement answers, mapped to the same shape drizzle's selects give. */
interface RawOutboxRow {
  id: string;
  user_id: string;
  kind: string;
  dedupe_key: string;
  title: string;
  body: string;
  data: Record<string, string>;
  // A raw statement hands timestamps back as the driver gives them (strings or dates); `toDate` makes them dates.
  occurred_at: Date | string;
  send_after: Date | string;
  status: string;
  attempts: number;
  claimed_at: Date | string | null;
  drop_reason: string | null;
  sent_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const toDateOrNull = (value: Date | string | null): Date | null => (value === null ? null : toDate(value));

const fromRaw = (row: RawOutboxRow): OutboxRow => ({
  id: row.id,
  userId: row.user_id,
  kind: row.kind,
  dedupeKey: row.dedupe_key,
  title: row.title,
  body: row.body,
  data: row.data,
  occurredAt: toDate(row.occurred_at),
  sendAfter: toDate(row.send_after),
  status: row.status,
  attempts: row.attempts,
  claimedAt: toDateOrNull(row.claimed_at),
  dropReason: row.drop_reason,
  sentAt: toDateOrNull(row.sent_at),
  createdAt: toDate(row.created_at),
  updatedAt: toDate(row.updated_at),
});

/**
 * Storage for the push outbox and its tickets (Phase 12F). Senders write rows, one dispatcher claims and sends them. Which
 * user a row belongs to is decided by the sender (the caller's own id, or the person a snapshot is about), never by a request.
 */
@Injectable()
export class PushOutboxRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** `true` when the push was queued, `false` when one with this dedupe key already exists (nothing is changed). */
  async enqueue(entry: NewOutboxEntry): Promise<boolean> {
    const inserted = await this.db
      .insert(pushOutbox)
      .values(entry)
      .onConflictDoNothing({ target: pushOutbox.dedupeKey })
      .returning({ id: pushOutbox.id });
    return inserted.length > 0;
  }

  /**
   * Takes up to `limit` rows that are due (pending and `send_after` has passed) and marks them `sending`. A row another
   * dispatcher holds is skipped (`FOR UPDATE SKIP LOCKED`), so two dispatchers never both get one; a row that has been
   * `sending` since before `staleBefore` (a dispatcher that died) is taken back and counted as a try, so a row that
   * keeps killing its dispatcher ends up failed instead of being taken back for ever.
   */
  async claimDue(now: Date, limit: number, staleBefore: Date): Promise<OutboxRow[]> {
    const result = await this.db.execute(sql`
      update push_outbox
      set status = 'sending', claimed_at = ${now}, updated_at = now(),
          attempts = case when status = 'sending' then attempts + 1 else attempts end
      where id in (
        select id from push_outbox
        where (status = 'pending' and send_after <= ${now})
           or (status = 'sending' and claimed_at < ${staleBefore})
        order by send_after, id
        limit ${limit}
        for update skip locked
      )
      returning *
    `);
    return (result.rows as unknown as RawOutboxRow[])
      .map(fromRaw)
      .sort((a, b) => a.sendAfter.getTime() - b.sendAfter.getTime() || a.id.localeCompare(b.id));
  }

  /** Renews a claim, so a long batch is not mistaken for a dispatcher that died. Only a row still `sending` is touched. */
  async touchClaim(id: string, at: Date): Promise<void> {
    await this.db
      .update(pushOutbox)
      .set({ claimedAt: at })
      .where(and(eq(pushOutbox.id, id), eq(pushOutbox.status, 'sending')));
  }

  async markSent(id: string, now: Date): Promise<void> {
    await this.db
      .update(pushOutbox)
      .set({ status: 'sent', sentAt: now, claimedAt: null, updatedAt: sql`now()` })
      .where(eq(pushOutbox.id, id));
  }

  async markDropped(id: string, reason: string): Promise<void> {
    await this.db
      .update(pushOutbox)
      .set({ status: 'dropped', dropReason: reason, claimedAt: null, updatedAt: sql`now()` })
      .where(eq(pushOutbox.id, id));
  }

  async markFailed(id: string): Promise<void> {
    await this.db
      .update(pushOutbox)
      .set({ status: 'failed', claimedAt: null, updatedAt: sql`now()` })
      .where(eq(pushOutbox.id, id));
  }

  /** Puts a claimed row back to pending for a later time; `countAttempt` says whether this was a failed try. */
  async release(id: string, sendAfter: Date, countAttempt: boolean): Promise<void> {
    await this.db
      .update(pushOutbox)
      .set({
        status: 'pending',
        claimedAt: null,
        sendAfter,
        attempts: countAttempt ? sql`${pushOutbox.attempts} + 1` : pushOutbox.attempts,
        updatedAt: sql`now()`,
      })
      .where(eq(pushOutbox.id, id));
  }

  async get(id: string): Promise<OutboxRow | null> {
    const [row] = await this.db.select().from(pushOutbox).where(eq(pushOutbox.id, id)).limit(1);
    return row ?? null;
  }

  async listForUser(userId: string): Promise<OutboxRow[]> {
    return this.db
      .select()
      .from(pushOutbox)
      .where(eq(pushOutbox.userId, userId))
      .orderBy(asc(pushOutbox.createdAt), asc(pushOutbox.id));
  }

  async addTickets(rows: readonly NewTicket[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(pushTickets).values(rows.map((row) => ({ ...row })));
  }

  /** Tickets created before `createdBefore` whose receipt has not been read, oldest first. */
  async dueTickets(createdBefore: Date, limit: number): Promise<DueTicket[]> {
    return this.db
      .select({ id: pushTickets.id, ticketId: pushTickets.ticketId, deviceTokenId: pushTickets.deviceTokenId })
      .from(pushTickets)
      .where(and(isNull(pushTickets.receiptCheckedAt), lte(pushTickets.createdAt, createdBefore)))
      .orderBy(asc(pushTickets.createdAt), asc(pushTickets.id))
      .limit(limit);
  }

  async markTicketsChecked(ids: readonly string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update(pushTickets).set({ receiptCheckedAt: now }).where(inArray(pushTickets.id, [...ids]));
  }

  /** Gives up on tickets the service never answered (receipts are kept for a day): marks them checked. */
  async expireTickets(createdBefore: Date, now: Date): Promise<number> {
    const expired = await this.db
      .update(pushTickets)
      .set({ receiptCheckedAt: now })
      .where(and(isNull(pushTickets.receiptCheckedAt), lt(pushTickets.createdAt, createdBefore)))
      .returning({ id: pushTickets.id });
    return expired.length;
  }

  /** Removes finished rows (sent, dropped, failed) last touched before `before`; their tickets go with them. */
  async purge(before: Date): Promise<number> {
    const removed = await this.db
      .delete(pushOutbox)
      .where(and(inArray(pushOutbox.status, ['sent', 'dropped', 'failed']), lt(pushOutbox.updatedAt, before)))
      .returning({ id: pushOutbox.id });
    return removed.length;
  }

  /** The person's stored time zone (quiet hours are read in it), or `null`. */
  async timeZoneOf(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ timezone: preferences.timezone })
      .from(preferences)
      .where(eq(preferences.userId, userId))
      .limit(1);
    return row?.timezone ?? null;
  }
}
