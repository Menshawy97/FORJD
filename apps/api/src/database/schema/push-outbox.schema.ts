import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { devicePushTokens } from './device-push-tokens.schema';
import { users } from './users.schema';

/**
 * The push outbox (Phase 12F, `docs/product/phase-12f-plan.md`, ADR-065). Every push is a row here before it is sent:
 * senders only write rows, one dispatcher sends what is due. That makes sending idempotent (the unique `dedupe_key`: a
 * retried upload queues one push), lets a push wait out the person's quiet hours (`send_after`), and works without an
 * in-process scheduler (Cloud Run scales to zero), with a small workflow that calls the dispatcher.
 *
 * The row keeps the text that was or will be shown (an exercise name, a city): personal data, so it goes with the account
 * (cascade), is in the export, and finished rows are purged after 30 days. Never a health value (ADR-061).
 *
 * No RLS, for the reason in `waitlist.schema.ts` (ADR-038): the API is the only credential that reaches these tables.
 */
export const pushOutbox = pgTable(
  'push_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `pr` or `rank`; kept in step with `PushKind` in `@forjd/domain` by the check below. */
    kind: text('kind').notNull(),
    /** What makes this push the same push if it is queued twice, e.g. `pr:<sessionId>` or `rank:<weekStart>:<user>`. */
    dedupeKey: text('dedupe_key').notNull().unique(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Strings only: a kind and an id (ADR-061). */
    data: jsonb('data').$type<Record<string, string>>().notNull(),
    /** When the thing happened (the session ended, the snapshot was taken); a push goes stale from here. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    sendAfter: timestamp('send_after', { withTimezone: true }).notNull(),
    /** `pending`, `sending` (claimed by a dispatcher), `sent`, `dropped` (not wanted or no longer useful), `failed`. */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    dropReason: text('drop_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('push_outbox_due_idx').on(table.status, table.sendAfter),
    index('push_outbox_user_idx').on(table.userId),
    check('push_outbox_kind', sql`${table.kind} in ('pr', 'rank')`),
    check('push_outbox_status', sql`${table.status} in ('pending', 'sending', 'sent', 'dropped', 'failed')`),
  ],
);

/**
 * One row per phone a push was accepted for: the push service's ticket, kept so its receipt can be read about a quarter of
 * an hour later (and a phone it reports gone removed). Deleted with its push, and with its token.
 */
export const pushTickets = pgTable(
  'push_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outboxId: uuid('outbox_id')
      .notNull()
      .references(() => pushOutbox.id, { onDelete: 'cascade' }),
    deviceTokenId: uuid('device_token_id')
      .notNull()
      .references(() => devicePushTokens.id, { onDelete: 'cascade' }),
    ticketId: text('ticket_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    receiptCheckedAt: timestamp('receipt_checked_at', { withTimezone: true }),
  },
  (table) => [
    index('push_tickets_unchecked_idx').on(table.receiptCheckedAt, table.createdAt),
    index('push_tickets_outbox_idx').on(table.outboxId),
  ],
);

export type PushOutboxRow = typeof pushOutbox.$inferSelect;
export type PushTicketRow = typeof pushTickets.$inferSelect;
