import { boolean, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * The five notification switches (Phase 12D, `docs/product/phase-12d-plan.md`), one row per user.
 * No row means "never saved": the API answers the defaults, which live in `@forjd/domain`
 * (`DEFAULT_NOTIFICATION_PREFERENCES`) and are repeated here as column defaults so a row created by
 * a partial change starts every other switch at the same value.
 *
 * Quiet hours are deliberately not columns yet: they arrive with their editor, as an additive
 * migration. `preferences.notifications_enabled` is a different, unwired single flag and is left alone.
 *
 * No RLS, for the reason in `waitlist.schema.ts` (ADR-038): the API is the only credential that
 * reaches this table, and authorization is the caller's own id in a NestJS guard.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  workout: boolean('workout').notNull().default(true),
  recovery: boolean('recovery').notNull().default(true),
  pr: boolean('pr').notNull().default(true),
  rank: boolean('rank').notNull().default(false),
  weekly: boolean('weekly').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
