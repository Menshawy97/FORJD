import { sql } from 'drizzle-orm';
import { date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  dateOfBirth: date('date_of_birth'),
  sex: text('sex'),
  heightCm: numeric('height_cm', { precision: 5, scale: 2 }),
  // Display preference only. Everything is stored in metric; conversion happens at the edge.
  // Retained as a *preset* that writes weightUnit and distanceUnit — see the three columns
  // below, which are the real preferences.
  unitSystem: text('unit_system').notNull().default('metric'),
  /**
   * Three independent display preferences. They are not derived from `unit_system` because
   * derivation is lossy: `kg` paired with `mi` belongs to no system, and `kJ` belongs to
   * neither system under any reading.
   *
   * `text`, not a Postgres enum, on purpose. Narrowing `sex` was free precisely because that
   * column is `text`; `ALTER TYPE` cannot remove a value from an enum at all. The price is
   * that a value can outlive its own valid set, which the repository handles on read.
   */
  weightUnit: text('weight_unit').notNull().default('kg'),
  distanceUnit: text('distance_unit').notNull().default('km'),
  energyUnit: text('energy_unit').notNull().default('kcal'),
  /**
   * Untargeted training intents and preferred activities, as arrays of stable slugs.
   *
   * Deliberately not rows in the existing `goals` table: that models a *measurable target*
   * with `target_value`, `target_date` and `status`, and "Get stronger" has none of those.
   * Storing it there would force those columns to hold something meaningless.
   *
   * NOT NULL with an empty-array default so "no goals chosen" and "goals never set" are the
   * same state — the alternative is a nullable array, which gives every reader three cases to
   * handle for a distinction the product does not make.
   *
   * **Renaming or removing a slug is a two-part change.** Updating `TRAINING_GOALS` /
   * `ACTIVITIES` in @forjd/domain only changes what the API *accepts*; rows already holding
   * the old value keep holding it, and the read-side filter then quietly drops it, so a user
   * sees a chip they had selected become deselected. The second part is a backfill migration
   * (`UPDATE profiles SET training_goals = array_replace(training_goals, 'old', 'new')`, and
   * the same for `activities`). Nothing forces this, and the failure is silent, which is
   * exactly why it is written down here next to the column.
   */
  trainingGoals: text('training_goals')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  activities: text('activities')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /**
   * A volunteered city name, plus a slug derived server-side for future grouping. No
   * coordinate is stored here and none crosses the network: docs/architecture/security.md
   * places location on WorkoutSession, and a lat/long column on the user record would
   * contradict it. The device reverse-geocodes locally and sends only the name.
   *
   * No `cities` table — leaderboards are Phase 10, and domain-model.md forbids placeholder
   * tables for phases that have not started.
   */
  city: text('city'),
  citySlug: text('city_slug'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type NewProfileRow = typeof profiles.$inferInsert;
