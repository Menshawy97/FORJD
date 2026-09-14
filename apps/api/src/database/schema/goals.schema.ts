import { date, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * Schema only in Phase 1 — no endpoints. The table exists so later phases migrate forward
 * rather than retrofitting the user's owned data model (CLAUDE.md: one capability at a time).
 */
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    targetValue: numeric('target_value', { precision: 10, scale: 2 }),
    targetDate: date('target_date'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // R28: `userId` is a foreign key with no covering index -- the table has no other index at
  // all, so any per-user lookup (once Phase 11's goals endpoints land) would be a sequential
  // scan.
  (table) => [index('goals_user_id_idx').on(table.userId)],
);

export type GoalRow = typeof goals.$inferSelect;
