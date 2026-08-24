import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.schema";

/**
 * One table for both the ingested catalogue and user-authored custom exercises
 * (ADR-017) -- `ownerUserId: null` marks a catalogue row, matching
 * `Exercise.ownerUserId` in @forjd/domain. A separate `custom_exercises` table was
 * considered and rejected: it would duplicate every column here, and every future
 * feature (favourites, workout logging) would need to query both tables and merge.
 *
 * `text[]`, never Postgres enums, for the vocabulary columns -- the same reasoning as
 * `profiles.schema.ts`: narrowing a tuple in @forjd/domain is free, narrowing a PG enum
 * is impossible (`ALTER TYPE` cannot remove a value).
 *
 * Soft-deleted (`deletedAt`), not hard-deleted -- Phase 3's workout sessions will
 * reference exercises by id, and a hard delete would either orphan that foreign key or
 * force a session to lose its own history when a user deletes an exercise they logged.
 *
 * NOT modeled here: `search_vector` (a generated `tsvector` column, GIN-indexed) and the
 * `name` trigram GIN index, both added by the hand-written migration
 * `0006_add-exercise-search-indexes.sql`. They are deliberately absent from this schema
 * object -- reflecting a generated column here would make drizzle-kit's diff engine believe
 * a future `generate` needs to (re)create it, colliding with the migration that already did.
 * Query `search_vector` through a raw `sql` tagged template in the repository, never through
 * the typed column builder.
 */
export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for the ingested catalogue; the owning user's id for a custom exercise. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** One of EXERCISE_CATEGORIES in @forjd/domain -- the design's chips, not the source's. */
    category: text("category").notNull(),
    /** One of EXERCISE_GOALS. Derived by the ingest adapter; chosen by the user for a custom exercise. */
    goal: text("goal").notNull(),
    /** One of EXERCISE_MEASURES ('weight' | 'time' | 'distance'). */
    measure: text("measure").notNull(),
    primaryMuscles: text("primary_muscles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    secondaryMuscles: text("secondary_muscles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    equipment: text("equipment")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * free-exercise-db-specific (force/level/mechanic). Nullable because a custom exercise
     * has no source data for these -- kept as canonical columns rather than adapter
     * metadata per ADR-017, since surfacing them costs nothing and a future source may
     * supply them too.
     */
    force: text("force"),
    level: text("level"),
    mechanic: text("mechanic"),
    instructions: text("instructions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Storage keys, never URLs (ADR-018) -- resolved to URLs at the API's read boundary
     * through a configurable media base URL, so a media-source change is a config change,
     * not a migration or a contract break.
     */
    imageKeys: text("image_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text("description"),
    /** Null for a custom exercise; the adapter's identifier (e.g. "free-exercise-db") otherwise. */
    source: text("source"),
    /** The source dataset's own id for this exercise -- free-exercise-db's own `id` field. */
    sourceId: text("source_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Closes the re-ingest race in the database rather than only in the loader script:
     * re-running `exercises:load` against the same source id can never create a duplicate
     * catalogue row, even under concurrent runs.
     */
    uniqueIndex("exercises_source_unique")
      .on(table.source, table.sourceId)
      .where(sql`${table.ownerUserId} is null`),
    /**
     * Mirrors `s_newExercise`'s duplicate-name check
     * (docs/design/phase2-screen-specs.md #6.1) in the database, so the race between two
     * concurrent creates is closed structurally rather than only by the service's
     * read-then-write check. Case-insensitive to match the prototype's
     * `.toLowerCase() === .toLowerCase()` comparison. Excludes soft-deleted rows so a
     * deleted exercise's name becomes reusable.
     */
    uniqueIndex("exercises_owner_name_unique")
      .on(table.ownerUserId, sql`lower(${table.name})`)
      .where(sql`${table.ownerUserId} is not null and ${table.deletedAt} is null`),
    index("exercises_category_idx").on(table.category),
    index("exercises_owner_idx").on(table.ownerUserId),
  ],
);

export type ExerciseRow = typeof exercises.$inferSelect;
export type NewExerciseRow = typeof exercises.$inferInsert;

/**
 * A join table, not a boolean column on `exercises` -- a favourite is a fact about a
 * (user, exercise) pair, and `exercises` rows are frequently shared across every user
 * (the catalogue), so a per-user flag cannot live on that row at all.
 */
export const exerciseFavourites = pgTable(
  "exercise_favourites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("exercise_favourites_pk").on(table.userId, table.exerciseId)],
);

export type ExerciseFavouriteRow = typeof exerciseFavourites.$inferSelect;
