import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users.schema';

/**
 * Weekly Forge (ADR-057). Two reference tables seeded from `@forjd/domain`'s `FORGE_TIERS` by
 * `forge:seed`, and four per-athlete tables, all deleted with the account.
 *
 * `ladder_key`, `band`, `outcome` and `type` are text, not Postgres enums, for the reason
 * `workouts.schema.ts` gives: a closed vocabulary lives in `@forjd/domain` (`FORGE_LADDERS`,
 * `FORGE_BANDS`, `FORGE_OUTCOMES`, `FORGE_REWARD_TYPES`), and an enum type cannot even have a value
 * removed. The per-athlete tables do not reference `forge_ladders`, so an athlete's history never
 * depends on the seed having run. RLS is off, like every other table here: authorization is in
 * NestJS (rule 12).
 */

/** One row per ladder, from `FORGE_LADDERS` and friends. Reference data, not user data. */
export const forgeLadders = pgTable('forge_ladders', {
  key: text('key').primaryKey(),
  unit: text('unit').notNull(),
  maxBand: text('max_band').notNull(),
  /** Nourish is never shown on the public athlete profile (ADR-057 decision 8). */
  isPublic: boolean('is_public').notNull(),
  sortOrder: integer('sort_order').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Every level's weekly target, per ladder, copied from `FORGE_TIERS` (the single source). */
export const forgeTiers = pgTable(
  'forge_tiers',
  {
    ladderKey: text('ladder_key')
      .notNull()
      .references(() => forgeLadders.key, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    band: text('band').notNull(),
    target: numeric('target', { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.ladderKey, table.level] })],
);

/**
 * An athlete's current position on one ladder. Always equal to folding their `forge_weeks` rows
 * through `evaluateWeek` in order: derived, rebuilt by a refold, never hand-patched (rule 9).
 */
export const forgeUserLadders = pgTable(
  'forge_user_ladders',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ladderKey: text('ladder_key').notNull(),
    level: integer('level').notNull().default(1),
    bestLevel: integer('best_level').notNull().default(1),
    missStreak: integer('miss_streak').notNull().default(0),
    temperedHoldWeeks: integer('tempered_hold_weeks').notNull().default(0),
    forgedStreak: integer('forged_streak').notNull().default(0),
    bestForgedStreak: integer('best_forged_streak').notNull().default(0),
    /** The Saturday of the week the athlete was enrolled: their first evaluated week. */
    enrolledWeek: date('enrolled_week').notNull(),
    /** The Saturday of the last week evaluated, or null before the first close. */
    lastEvaluatedWeek: date('last_evaluated_week'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.ladderKey] }),
    check('forge_user_ladders_levels', sql`${table.level} >= 1 and ${table.bestLevel} >= ${table.level}`),
    check(
      'forge_user_ladders_streaks',
      sql`${table.missStreak} >= 0 and ${table.temperedHoldWeeks} >= 0 and ${table.forgedStreak} >= 0 and ${table.bestForgedStreak} >= ${table.forgedStreak}`,
    ),
  ],
);

/**
 * One closed week on one ladder: the locked total and what it did. Written once by the evaluation
 * job and never updated, so edits after the close never change a closed week (ADR-057 decision 2).
 */
export const forgeWeeks = pgTable(
  'forge_weeks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ladderKey: text('ladder_key').notNull(),
    /** The Saturday that starts the week, in the athlete's zone at the time. */
    weekStart: date('week_start').notNull(),
    timeZone: text('time_zone').notNull(),
    closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
    /** The locked weekly total, in the ladder's unit. */
    total: numeric('total', { precision: 12, scale: 2 }).notNull(),
    target: numeric('target', { precision: 10, scale: 2 }).notNull(),
    levelBefore: integer('level_before').notNull(),
    levelAfter: integer('level_after').notNull(),
    bandBefore: text('band_before').notNull(),
    bandAfter: text('band_after').notNull(),
    outcome: text('outcome').notNull(),
    missStreakAfter: integer('miss_streak_after').notNull(),
    temperedHoldWeeksAfter: integer('tempered_hold_weeks_after').notNull(),
    forgedStreakAfter: integer('forged_streak_after').notNull(),
    /** Which rule set judged the week, so a future rule change is a deliberate refold. */
    rulesVersion: integer('rules_version').notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('forge_weeks_key').on(table.userId, table.ladderKey, table.weekStart),
    // The week-close summary and pending celebrations read every ladder of one week at once.
    index('forge_weeks_user_week_idx').on(table.userId, table.weekStart),
  ],
);

/**
 * The rewards ledger: append-only (ADR-057 decision 7). No code path updates or deletes a row; only
 * the account-deletion cascade removes them. The partial unique indexes make every insert
 * idempotent, so a re-run evaluation writes `on conflict do nothing` and adds nothing twice.
 */
export const forgeRewards = pgTable(
  'forge_rewards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ladderKey: text('ladder_key').notNull(),
    type: text('type').notNull(),
    level: integer('level').notNull(),
    band: text('band').notNull(),
    weekStart: date('week_start').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The partial keys below cannot serve a plain `user_id` lookup, which the profile's badge read
    // and the account-deletion cascade both need (the 0028 foreign-key index rule).
    index('forge_rewards_user_idx').on(table.userId),
    uniqueIndex('forge_rewards_mark_key')
      .on(table.userId, table.ladderKey, table.level)
      .where(sql`${table.type} = 'forge_mark'`),
    uniqueIndex('forge_rewards_badge_key')
      .on(table.userId, table.ladderKey, table.band)
      .where(sql`${table.type} = 'band_badge'`),
    uniqueIndex('forge_rewards_forged_key')
      .on(table.userId, table.ladderKey, table.weekStart)
      .where(sql`${table.type} = 'forged'`),
  ],
);

/** A closed week whose celebration and summary the athlete has seen. */
export const forgeWeekAcks = pgTable(
  'forge_week_acks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(),
    ackedAt: timestamp('acked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.weekStart] })],
);

export type ForgeUserLadderRow = typeof forgeUserLadders.$inferSelect;
export type ForgeWeekRow = typeof forgeWeeks.$inferSelect;
export type NewForgeWeekRow = typeof forgeWeeks.$inferInsert;
export type ForgeRewardRow = typeof forgeRewards.$inferSelect;
