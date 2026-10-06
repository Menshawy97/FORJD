import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * The notification switches (Phase 12D, `docs/product/phase-12d-plan.md`; the four 12E reminders at the end,
 * `docs/product/phase-12e-plan.md`), one row per user.
 * No row means "never saved": the API answers the defaults, which live in `@forjd/domain`
 * (`DEFAULT_NOTIFICATION_PREFERENCES`) and are repeated here as column defaults so a row created by
 * a partial change starts every other switch at the same value.
 *
 * Quiet hours (the 12E follow-up) are two minutes-since-midnight columns, 22:00 and 07:00 until the person changes
 * them. The start is quiet and the end is not; a start after the end runs through midnight. A check keeps both on the
 * clock and different, so the planner never meets an empty or whole-day window.
 * `preferences.notifications_enabled` is a different, unwired single flag and is left alone.
 *
 * No RLS, for the reason in `waitlist.schema.ts` (ADR-038): the API is the only credential that
 * reaches this table, and authorization is the caller's own id in a NestJS guard.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    workout: boolean('workout').notNull().default(true),
    recovery: boolean('recovery').notNull().default(true),
    pr: boolean('pr').notNull().default(true),
    rank: boolean('rank').notNull().default(false),
    weekly: boolean('weekly').notNull().default(true),
    // The 12E reminders are opt-in, so a row created by an older phone's partial change leaves them off.
    meals: boolean('meals').notNull().default(false),
    noWorkout: boolean('no_workout').notNull().default(false),
    forgeClosing: boolean('forge_closing').notNull().default(false),
    weighIn: boolean('weigh_in').notNull().default(false),
    // Defaults repeat DEFAULT_QUIET_HOURS in `@forjd/domain` (22:00 and 07:00), like the switches above.
    quietStartMinute: integer('quiet_start_minute').notNull().default(1320),
    quietEndMinute: integer('quiet_end_minute').notNull().default(420),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'notification_preferences_quiet_hours',
      sql`${table.quietStartMinute} between 0 and 1439 and ${table.quietEndMinute} between 0 and 1439 and ${table.quietStartMinute} <> ${table.quietEndMinute}`,
    ),
  ],
);

export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
