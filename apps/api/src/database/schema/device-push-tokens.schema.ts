import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * The push tokens of a person's phones (Phase 12F, `docs/product/phase-12f-plan.md`). A token identifies one app
 * install at the push service, so it is unique: if a phone signs in as someone else the row moves to them and the
 * earlier account stops receiving pushes there. Deleted with the account (cascade), on sign-out by the phone, and by
 * the sender when the service reports the token dead.
 *
 * No RLS, for the reason in `waitlist.schema.ts` (ADR-038): the API is the only credential that reaches this table,
 * and authorization is the caller's own id in a NestJS guard (CLAUDE.md rule 12).
 */
export const devicePushTokens = pgTable(
  'device_push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    /** `android` or `ios`; kept in step with `PUSH_PLATFORMS` in `@forjd/contracts` by the check below. */
    platform: text('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('device_push_tokens_user_idx').on(table.userId),
    check('device_push_tokens_platform', sql`${table.platform} in ('android', 'ios')`),
  ],
);

export type DevicePushTokenRow = typeof devicePushTokens.$inferSelect;
