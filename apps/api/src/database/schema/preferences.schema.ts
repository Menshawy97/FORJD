import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

// Schema only in Phase 1 — no endpoints yet.
export const preferences = pgTable('preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  timezone: text('timezone'),
  locale: text('locale'),
  /**
   * Unwired, and superseded by `notification_preferences` (Phase 12D), which holds the five real
   * switches. Nothing reads or writes this column, and nothing enforces it. It is left in place rather
   * than migrated away; annotated here so a future session does not mistake its presence for a
   * working feature.
   */
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PreferenceRow = typeof preferences.$inferSelect;
