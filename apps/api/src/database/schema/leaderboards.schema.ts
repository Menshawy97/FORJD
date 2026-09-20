import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.schema';

/**
 * Where everyone stood at the start of a week, so the leaderboard can show a real "up 3 this
 * week" (Phase 10, ADR-047).
 *
 * **Never updated.** Standings are derived, and CLAUDE.md rule 9 says derived data is recomputed,
 * not patched. Re-running a week deletes that week's rows for the city and inserts them again from
 * a fresh computation, in one transaction, which is also what makes the job safe to re-run. A row
 * here is a fact about the past that is only ever replaced wholesale.
 *
 * `metric` and `period` are text, not Postgres enums, for the reason `workouts.schema.ts` gives:
 * a closed vocabulary lives in `@forjd/domain` (`LEADERBOARD_METRICS`, `LEADERBOARD_PERIODS`), and
 * an enum type cannot even have a value removed. RLS is off, like every other table here, because
 * authorization is in NestJS (rule 12).
 *
 * Deleted with the account (`on delete cascade`), so a deleted athlete leaves no rank history.
 */
export const leaderboardRankSnapshots = pgTable(
  'leaderboard_rank_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The city the athlete was ranked in. Part of the key: moving city starts a fresh history. */
    citySlug: text('city_slug').notNull(),
    metric: text('metric').notNull(),
    period: text('period').notNull(),
    /** The Monday, in the CITY's own calendar, of the week this was captured for. */
    weekStart: date('week_start').notNull(),
    rank: integer('rank').notNull(),
    /** One decimal, 0.0 to 100.0: what the screen shows. */
    score: numeric('score', { precision: 5, scale: 1 }).notNull(),
    cohortSize: integer('cohort_size').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('leaderboard_rank_snapshots_key').on(
      table.userId,
      table.citySlug,
      table.metric,
      table.period,
      table.weekStart,
    ),
    // One city, metric and period across weeks: the job's delete-and-reinsert, and the read of
    // "everyone's rank a week ago" for a window of rows.
    index('leaderboard_rank_snapshots_lookup').on(table.citySlug, table.metric, table.period, table.weekStart),
  ],
);

export type LeaderboardRankSnapshotRow = typeof leaderboardRankSnapshots.$inferSelect;
export type NewLeaderboardRankSnapshotRow = typeof leaderboardRankSnapshots.$inferInsert;
