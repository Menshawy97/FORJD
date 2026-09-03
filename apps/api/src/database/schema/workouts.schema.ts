import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid, boolean, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.schema";
import { exercises } from "./exercises.schema";

/**
 * Workout engine schema (Phase 3). Two independent halves that never overwrite each other
 * (`docs/architecture/workout-engine.md`, `docs/product/phase-3-plan.md`'s locked decisions):
 *
 * - The **template** half -- what the program tells the user to do:
 *   `workout_templates -> workout_blocks -> workout_exercises`.
 * - The **session** half -- what the user actually did:
 *   `workout_sessions -> workout_session_exercises -> workout_sets`.
 *
 * A template saying `Squat 4x8 @ 100kg` and a session recording `100x8, 100x8, 100x7, 95x8`
 * are the two series progression analytics compares; collapsing them into one table destroys
 * the only signal it has. `WorkoutSessionEvent` (the on-device append-only log) has no table
 * here -- it is local-only in `expo-sqlite` (Phase F) and never uploaded, because the server
 * receives the rebuilt session, not the keystrokes that produced it.
 *
 * Column shapes mirror `@forjd/domain`'s `workout-vocabulary.ts` interfaces exactly. Every
 * closed-vocabulary column (`type`, `status`, `perceived_effort`, `activity`, `measure`) is
 * `text`, never a Postgres enum, for the same reason every other such column in this codebase
 * is: narrowing a tuple in the domain package is free, `ALTER TYPE` cannot remove a value.
 *
 * Weight and distance are `numeric`, matching `nutrition.schema.ts`'s own convention --
 * Postgres `numeric` maps to a JS `string` through drizzle-orm to avoid float precision loss,
 * converted at the repository boundary (`.toString()` on write, `Number(...)` on read).
 *
 * RLS is not enabled on these tables, matching `exercises.schema.ts` and `nutrition.schema.ts`
 * -- no client ever holds a Supabase credential (ADR-008: the mobile app talks to NestJS, not
 * Supabase directly), so the standing gating rule that triggers enabling it is not tripped.
 * Authorization for these tables lives in the NestJS service layer (Phase D/E), per rule 12.
 */

/* ------------------------------------------------------------------------------------------
 * Template half: what the program tells the user to do.
 * ---------------------------------------------------------------------------------------- */

/**
 * A prescription, not a record. Owner-scoped with a nullable owner, exactly like `exercises`
 * and `foods`: `ownerUserId: null` marks a curated/system template, non-null marks the user's
 * own -- what lets a curated program ship later (Phase K) without a second table.
 *
 * Soft delete, never hard delete (`deletedAt`): a session references its template by id, and a
 * hard delete would either orphan that reference or rewrite someone's training history.
 */
export const workoutTemplates = pgTable(
  "workout_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for a curated/system template; the owning user's id for a user's own. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** One of ACTIVITIES in @forjd/domain -- reuses the profile's own activity vocabulary. */
    activity: text("activity").notNull(),
    /**
     * The template this one was copied from, if any -- the design's "Customised preset"
     * state. `null` for a template built from scratch and for the curated templates
     * themselves. `set null` on delete: hard-deleting a base template (which soft delete
     * makes rare) must not cascade into deleting a user's own customised copy.
     */
    basedOnTemplateId: uuid("based_on_template_id").references(
      (): AnyPgColumn => workoutTemplates.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    /** The design's "~52 min" line -- an estimate, never a measurement. */
    estimatedDurationMinutes: integer("estimated_duration_minutes"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workout_templates_owner_idx").on(table.ownerUserId)],
);

export type WorkoutTemplateRow = typeof workoutTemplates.$inferSelect;
export type NewWorkoutTemplateRow = typeof workoutTemplates.$inferInsert;

/**
 * One grouped unit of work inside a template. Carries its `type` from day one even though
 * only `straight_sets` is implemented in Phase 3 -- see `WORKOUT_BLOCK_TYPES` in
 * `@forjd/domain`. The round/work/rest/cap columns are `null` for `straight_sets`, where the
 * per-exercise prescription on `workout_exercises` carries everything instead.
 */
export const workoutBlocks = pgTable(
  "workout_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workoutTemplates.id, { onDelete: "cascade" }),
    /** One of WORKOUT_BLOCK_TYPES in @forjd/domain. */
    type: text("type").notNull(),
    orderIndex: integer("order_index").notNull(),
    /** Optional label the design shows on multi-block workouts, e.g. "Strength A". */
    name: text("name"),
    /** Rounds for interval/amrap/superset; null for straight_sets. */
    rounds: integer("rounds"),
    workSeconds: integer("work_seconds"),
    restSeconds: integer("rest_seconds"),
    /** Total cap for an amrap block ("as many rounds as possible in 12 minutes"). */
    capSeconds: integer("cap_seconds"),
  },
  (table) => [
    // The builder/detail screen's own read: "give me this template's blocks, in order".
    index("workout_blocks_template_order_idx").on(table.templateId, table.orderIndex),
  ],
);

export type WorkoutBlockRow = typeof workoutBlocks.$inferSelect;
export type NewWorkoutBlockRow = typeof workoutBlocks.$inferInsert;

/**
 * One prescribed exercise inside a block. Which target field is meaningful follows the
 * referenced exercise's own `measure` column (`weight | time | distance`) -- the
 * discriminator the whole engine reads; this table does not restate it.
 *
 * `exerciseId` is `onDelete: "restrict"`, mirroring `nutrition_log_entries.food_id`:
 * exercises are soft-deleted and referenced permanently by templates, so a hard delete of a
 * still-referenced exercise must fail loudly rather than silently orphan a prescription.
 */
export const workoutExercises = pgTable(
  "workout_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => workoutBlocks.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    orderIndex: integer("order_index").notNull(),
    /** How many sets are prescribed. Null in a block whose `rounds` supplies the count. */
    setCount: integer("set_count"),
    targetReps: integer("target_reps"),
    /** Upper bound of a prescribed rep range; null when a single value was prescribed. */
    targetRepsMax: integer("target_reps_max"),
    /** Always kilograms (ADR-016). Display conversion happens at the screen. */
    targetWeightKg: numeric("target_weight_kg", { precision: 8, scale: 2 }),
    targetSeconds: integer("target_seconds"),
    /** Always metres, for the same reason weights are always kg. */
    targetDistanceMeters: numeric("target_distance_meters", { precision: 10, scale: 2 }),
    /** Prescribed rest after each set; the live screen's default applies when null. */
    restSeconds: integer("rest_seconds"),
    notes: text("notes"),
  },
  (table) => [
    index("workout_exercises_block_order_idx").on(table.blockId, table.orderIndex),
    index("workout_exercises_exercise_idx").on(table.exerciseId),
  ],
);

export type WorkoutExerciseRow = typeof workoutExercises.$inferSelect;
export type NewWorkoutExerciseRow = typeof workoutExercises.$inferInsert;

/* ------------------------------------------------------------------------------------------
 * Session half: what the user actually did.
 * ---------------------------------------------------------------------------------------- */

/**
 * A record of a performed workout. **`id` has no `defaultRandom()`** -- unlike every other
 * table in this schema, it is generated on the device at session start and sent by the
 * client. That client-generated UUID is also the sync idempotency key
 * (`phase-3-plan.md`'s locked decisions): a retried upload after a dropped response is a
 * second insert attempt with the same primary key, which the repository turns into "return
 * the existing row" rather than a duplicate (Phase E).
 *
 * Nothing here is ever back-filled from the template it references. If the user was
 * prescribed 100 kg and lifted 95, this row says 95.
 */
export const workoutSessions = pgTable(
  "workout_sessions",
  {
    /** Client-generated at session start on-device; also the sync idempotency key. */
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Null for an ad-hoc session started without a template. `set null` on delete: hard
     * deleting a template must not delete or orphan the sessions performed against it --
     * `name` below has already snapshotted what it needs.
     */
    templateId: uuid("template_id").references(() => workoutTemplates.id, {
      onDelete: "set null",
    }),
    /**
     * Snapshotted from the template at session start -- a session must still name itself
     * after its template is renamed or deleted. The one place a snapshot is correct: it is a
     * label, not data the template could be re-derived from.
     */
    name: text("name").notNull(),
    /** One of ACTIVITIES in @forjd/domain. */
    activity: text("activity").notNull(),
    /** One of WORKOUT_SESSION_STATUSES in @forjd/domain. */
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Null while the session is in_progress or paused. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * Elapsed working time, excluding paused stretches -- not simply
     * `endedAt - startedAt`. Rebuilt from the local event log on-device, which is what
     * survives a mid-session crash.
     */
    durationSeconds: integer("duration_seconds").notNull(),
    /** One of PERCEIVED_EFFORTS in @forjd/domain. Null until the summary screen sets it. */
    perceivedEffort: text("perceived_effort"),
    notes: text("notes"),
    /**
     * Coarse location, captured at session start and stored here -- never on the user
     * record (`docs/architecture/security.md`) -- which is what makes "the leaderboard
     * doesn't follow you when you relocate" true by construction. Null unless the user
     * opted in to location for leaderboards.
     */
    city: text("city"),
    citySlug: text("city_slug"),
    /**
     * Whether this session was tracked live, with real start/end timestamps, rather than
     * entered or backdated afterwards -- the anti-cheat fact `leaderboard_eligible` rests
     * on at read time (security.md). Eligibility itself is not stored here: it also depends
     * on the user's current privacy opt-in, which changes independently of this row.
     */
    isLiveTracked: boolean("is_live_tracked").notNull().default(false),
    /**
     * Soft delete, never hard delete -- an abandoned/cancelled session is still evidence
     * about a user's week (`status: 'cancelled'` already covers "the user stopped"; this
     * covers "the row itself was removed").
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Home's stat strip and "This week"/"Recent PR" (Phase J), and workout history (Phase
    // G): "give me this user's sessions, most recent first" is the whole WHERE+ORDER BY.
    index("workout_sessions_user_started_idx").on(table.userId, table.startedAt),
    index("workout_sessions_template_idx").on(table.templateId),
  ],
);

export type WorkoutSessionRow = typeof workoutSessions.$inferSelect;
export type NewWorkoutSessionRow = typeof workoutSessions.$inferInsert;

/** One exercise as it was actually performed within a session. */
export const workoutSessionExercises = pgTable(
  "workout_session_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    orderIndex: integer("order_index").notNull(),
    /**
     * Copied from the exercise at session start so a set can be interpreted without a join,
     * and so changing an exercise's measure later cannot retroactively reinterpret sets
     * already logged as something else.
     */
    measure: text("measure").notNull(),
    notes: text("notes"),
  },
  (table) => [
    index("workout_session_exercises_session_order_idx").on(table.sessionId, table.orderIndex),
    index("workout_session_exercises_exercise_idx").on(table.exerciseId),
  ],
);

export type WorkoutSessionExerciseRow = typeof workoutSessionExercises.$inferSelect;
export type NewWorkoutSessionExerciseRow = typeof workoutSessionExercises.$inferInsert;

/**
 * One performed set -- the leaf of the whole engine, and the row progression analytics reads.
 * Which value column is populated follows the parent's `measure`: `weight` uses
 * `weightKg` + `reps`, `time` uses `durationSeconds`, `distance` uses `distanceMeters`. They
 * are separate nullable columns rather than one polymorphic value so a query like "heaviest
 * bench press" does not have to parse anything.
 */
export const workoutSets = pgTable(
  "workout_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionExerciseId: uuid("session_exercise_id")
      .notNull()
      .references(() => workoutSessionExercises.id, { onDelete: "cascade" }),
    setIndex: integer("set_index").notNull(),
    /** One of WORKOUT_SET_TYPES in @forjd/domain. */
    type: text("type").notNull(),
    /**
     * A set can exist and be unticked -- the live screen renders the prescribed sets up
     * front and the user ticks them off, so an unfinished session carries incomplete rows
     * rather than missing ones. Analytics must filter on this, not assume every row happened.
     */
    isCompleted: boolean("is_completed").notNull().default(false),
    /** Always kilograms (ADR-016). */
    weightKg: numeric("weight_kg", { precision: 8, scale: 2 }),
    reps: integer("reps"),
    durationSeconds: integer("duration_seconds"),
    /** Always metres. */
    distanceMeters: numeric("distance_meters", { precision: 10, scale: 2 }),
    /** Rest actually taken after this set, from the local event log's rest events. */
    restSeconds: integer("rest_seconds"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("workout_sets_session_exercise_idx").on(table.sessionExerciseId, table.setIndex),
  ],
);

export type WorkoutSetRow = typeof workoutSets.$inferSelect;
export type NewWorkoutSetRow = typeof workoutSets.$inferInsert;

/* ------------------------------------------------------------------------------------------
 * Program half (Phase 3K): a named, multi-week plan the athlete follows.
 *
 * `docs/product/phase-3k-plan.md` explains why this is `programs -> program_workouts` and not
 * the `programs -> program_weeks -> program_days` the phase outline sketched: a preset program
 * is a *set of named workouts* plus a duration and a level, and weekday assignment exists only
 * in the builder, for custom programs.
 * ---------------------------------------------------------------------------------------- */

export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Null for a catalogue preset, exactly as `workout_templates.owner_user_id` is -- the same
     * "visible to everyone" convention, so the existing `visibleTo` predicate applies unchanged.
     */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Stable across renames; unique among presets only (see the index below). */
    slug: text("slug").notNull(),
    /** One of PROGRAM_CATEGORIES in @forjd/domain -- how the catalogue's filter chips file it. */
    category: text("category").notNull(),
    /** One of PROGRAM_LEVELS in @forjd/domain. Not `LEVELS`: the design says "Advanced". */
    level: text("level").notNull(),
    /** The two halves of the design's `4 days · 8 weeks` meta line, stored as numbers. */
    daysPerWeek: integer("days_per_week").notNull(),
    durationWeeks: integer("duration_weeks").notNull(),
    description: text("description"),
    /**
     * Bumped whenever a program's content is rewritten. An enrolment snapshots the version it
     * began under -- see `program_enrollments.program_version`, and the honest limits of what
     * that currently buys, in `phase-3k-plan.md`.
     */
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("programs_owner_idx").on(table.ownerUserId),
    index("programs_category_idx").on(table.category),
    /**
     * Presets only. A partial unique index rather than a plain one, because two athletes may
     * each build a custom program called "My Split" and neither should collide with the other
     * or with a catalogue slug.
     */
    uniqueIndex("programs_preset_slug_key")
      .on(table.slug)
      .where(sql`owner_user_id is null`),
  ],
);

export type ProgramRow = typeof programs.$inferSelect;
export type NewProgramRow = typeof programs.$inferInsert;

/**
 * The join that makes a program's workouts *be* workout templates.
 *
 * `restrict` on delete rather than cascade: a template still referenced by a program is not one
 * to remove silently, and the alternative -- a program quietly losing a day -- is the kind of
 * hollowing-out this phase's plan explicitly refuses.
 */
export const programWorkouts = pgTable(
  "program_workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workoutTemplates.id, { onDelete: "restrict" }),
    orderIndex: integer("order_index").notNull(),
    /**
     * `0`-`6`, indexed like `Date#getDay()`, so nothing between here and the client converts an
     * index and risks reversing it.
     *
     * **Null for a preset**, which prescribes a set of workouts rather than a calendar. Only
     * the builder's custom programs pin a workout to a weekday.
     */
    dayOfWeek: integer("day_of_week"),
  },
  (table) => [index("program_workouts_program_order_idx").on(table.programId, table.orderIndex)],
);

export type ProgramWorkoutRow = typeof programWorkouts.$inferSelect;
export type NewProgramWorkoutRow = typeof programWorkouts.$inferInsert;

/**
 * Who is following what.
 *
 * Ended rather than deleted, so "you followed this for six weeks last spring" survives -- the
 * same soft-history reasoning `workout_sessions.deleted_at` documents.
 */
export const programEnrollments = pgTable(
  "program_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    /** Snapshotted at enrolment from `programs.version`. */
    programVersion: integer("program_version").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null while active. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("program_enrollments_user_idx").on(table.userId),
    /**
     * One active program at a time, which the design assumes throughout -- `activeProgram` is a
     * single value and Train renders one "Currently following:" chip.
     *
     * Defence in depth only. The same rule is enforced in the service, because a rule that
     * exists only in SQL is a rule that cannot be unit-tested (CLAUDE.md rule 12).
     */
    uniqueIndex("program_enrollments_one_active_key")
      .on(table.userId)
      .where(sql`ended_at is null`),
  ],
);

export type ProgramEnrollmentRow = typeof programEnrollments.$inferSelect;
export type NewProgramEnrollmentRow = typeof programEnrollments.$inferInsert;
