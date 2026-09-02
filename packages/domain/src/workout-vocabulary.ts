/**
 * Canonical workout vocabulary (Phase 3). Same `as const` tuple + display-name map pattern as
 * `exercise-vocabulary.ts` and `nutrition-vocabulary.ts` -- `@forjd/contracts` builds
 * `z.enum(...)` from these tuples, so drift between the domain and the wire is
 * unrepresentable, and the UI never hardcodes a label.
 *
 * Every closed set below backs a `text` column, never a Postgres enum, for the reason
 * `phase-3-plan.md`'s locked-decisions table gives: adding a value to a PG enum is a
 * migration, adding one to a tuple is not -- and `ALTER TYPE` cannot remove a value at all.
 *
 * This file is pure TypeScript with no imports beyond this package, enforced by CI's
 * conformance check (CLAUDE.md rules 1-2).
 *
 * @see docs/architecture/workout-engine.md -- the design this vocabulary encodes.
 * @see docs/product/phase-3-plan.md -- the locked decisions it must not contradict.
 */

import type { Activity, DistanceUnit, WeightUnit } from "./index";
import type { ExerciseMeasure } from "./exercise-vocabulary";

/**
 * The five block types `workout-engine.md` names, all present from the first migration even
 * though **only `straight_sets` is implemented in Phase 3**. That is the whole point of the
 * decision: HYROX, running and Pilates then arrive as *content* (new blocks, new templates)
 * rather than as a schema migration and a second workout engine.
 */
export const WORKOUT_BLOCK_TYPES = [
  "straight_sets",
  "superset",
  "interval",
  "amrap",
  "time_based",
] as const;
export type WorkoutBlockType = (typeof WORKOUT_BLOCK_TYPES)[number];

export const WORKOUT_BLOCK_TYPE_DISPLAY_NAMES: Record<WorkoutBlockType, string> = {
  straight_sets: "Straight sets",
  superset: "Superset",
  interval: "Interval",
  amrap: "AMRAP",
  time_based: "Time-based",
};

/**
 * What a single logged set *was*. The design's live screen writes only `working` -- it draws
 * an undifferentiated list of sets with no warm-up affordance -- so the other two are
 * deliberately unreachable from the UI today. They exist for the same reason the
 * unimplemented block types do: `workout_sets.type` is written from the first session
 * onward, and discovering the column needs another value afterwards is a migration plus a
 * backfill, whereas widening this tuple is neither.
 *
 * Kept to three. A longer speculative list (rest-pause, cluster, myo-rep) would be
 * generality nobody asked for; these three are the ones a strength template can already
 * express and that progression analytics must be able to exclude from a working-set volume
 * total.
 */
export const WORKOUT_SET_TYPES = ["working", "warmup", "drop"] as const;
export type WorkoutSetType = (typeof WORKOUT_SET_TYPES)[number];

export const WORKOUT_SET_TYPE_DISPLAY_NAMES: Record<WorkoutSetType, string> = {
  working: "Working set",
  warmup: "Warm-up set",
  drop: "Drop set",
};

/**
 * The lifecycle a session can reach. `paused` is a real persisted status rather than a
 * transient UI flag because the local event log records `workout_paused`/`workout_resumed`
 * and a force-killed app must rebuild the paused state on replay -- if pause lived only in
 * React state, crash recovery would silently resume a session the user had stopped.
 *
 * `cancelled` is the prototype's "Workout cancelled" path. It is a status, not a delete: a
 * session the user abandoned is still evidence about their week, and hard-deleting it would
 * contradict the soft-delete-never-hard-delete decision.
 */
export const WORKOUT_SESSION_STATUSES = [
  "in_progress",
  "paused",
  "completed",
  "cancelled",
] as const;
export type WorkoutSessionStatus = (typeof WORKOUT_SESSION_STATUSES)[number];

export const WORKOUT_SESSION_STATUS_DISPLAY_NAMES: Record<WorkoutSessionStatus, string> = {
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * The workout-complete screen's qualitative effort row, in the design's own order. It is
 * deliberately *not* a 1-10 RPE number: the design asks a four-way question, and storing a
 * number the user never chose would invent precision that was never collected.
 */
export const PERCEIVED_EFFORTS = ["easy", "solid", "hard", "brutal"] as const;
export type PerceivedEffort = (typeof PERCEIVED_EFFORTS)[number];

export const PERCEIVED_EFFORT_DISPLAY_NAMES: Record<PerceivedEffort, string> = {
  easy: "Easy",
  solid: "Solid",
  hard: "Hard",
  brutal: "Brutal",
};

/**
 * The append-only local event log `workout-engine.md` specifies verbatim, and the reason
 * crash recovery is real rather than aspirational: the app can be killed mid-session and the
 * session state rebuilt by replaying these in order. A mutable "current session" row cannot
 * do that.
 *
 * The architecture doc writes them in PascalCase (`SetCompleted`); they are slugs here
 * because every other stored value set in this package is a slug, and these are written to a
 * `text` column in on-device SQLite.
 */
export const WORKOUT_EVENT_TYPES = [
  "set_completed",
  "rest_started",
  "rest_completed",
  "exercise_completed",
  "workout_paused",
  "workout_resumed",
  "workout_finished",
] as const;
export type WorkoutEventType = (typeof WORKOUT_EVENT_TYPES)[number];

export const WORKOUT_EVENT_TYPE_DISPLAY_NAMES: Record<WorkoutEventType, string> = {
  set_completed: "Set completed",
  rest_started: "Rest started",
  rest_completed: "Rest completed",
  exercise_completed: "Exercise completed",
  workout_paused: "Workout paused",
  workout_resumed: "Workout resumed",
  workout_finished: "Workout finished",
};

/* ------------------------------------------------------------------------------------------
 * The template half: what the program tells the user to do.
 *
 * `workout_templates -> workout_blocks -> workout_exercises`
 * (docs/architecture/domain-model.md). Never overwritten with what actually happened -- that
 * split is the most load-bearing decision in this engine, because a template saying
 * `Squat 4x8 @ 100kg` and a session recording `100x8, 100x8, 100x7, 95x8` are the two series
 * progression analytics compares. Collapsing them destroys the only signal it has.
 * ---------------------------------------------------------------------------------------- */

/**
 * A prescription, not a record. Owner-scoped with a nullable owner, exactly like `Exercise`:
 * `ownerUserId === null` marks a curated/system template, non-null marks the user's own. That
 * is what lets a curated program ship later without a second table.
 */
export interface WorkoutTemplate {
  id: string;
  /** `null` for a curated/system template; the owning user's id for a user's own. */
  ownerUserId: string | null;
  name: string;
  /**
   * Reuses the existing `Activity` tuple rather than introducing a parallel "workout type"
   * discriminator -- the profile's activity chips and a template's modality are the same
   * question, and a second vocabulary for it would drift from the first.
   */
  activity: Activity;
  /**
   * The template this one was copied from, if any -- the design's "Customised preset" state,
   * which is a user-owned template that remembers its curated origin. `null` for a template
   * built from scratch and for the curated templates themselves.
   */
  basedOnTemplateId: string | null;
  notes: string | null;
  /**
   * The design's "~52 min" line. An estimate the template carries, never a measurement: how
   * long a session actually took lives on `WorkoutSession.durationSeconds`.
   */
  estimatedDurationMinutes: number | null;
  blocks: WorkoutBlock[];
  /**
   * Soft delete, never hard delete. A session references its template by id; removing the
   * row would either orphan that reference or rewrite someone's training history.
   */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One grouped unit of work inside a template. Carries its `type` from day one even while
 * only `straight_sets` is implemented -- see `WORKOUT_BLOCK_TYPES`.
 *
 * The round/work/rest fields are the ones the non-straight-set types need (the design's
 * "8 rounds x 60s" conditioning workout is an interval block). They are `null` for
 * `straight_sets`, where the per-exercise prescription carries everything instead.
 */
export interface WorkoutBlock {
  id: string;
  templateId: string;
  type: WorkoutBlockType;
  /** Position within the template. Dense and zero-based; the repository assigns it. */
  orderIndex: number;
  /** An optional label the design shows on multi-block workouts, e.g. "Strength A". */
  name: string | null;
  /** Rounds for `interval` / `amrap` / `superset`; `null` for `straight_sets`. */
  rounds: number | null;
  /** Work interval for `interval` / `time_based` blocks. */
  workSeconds: number | null;
  /** Rest between rounds. Per-exercise rest lives on `WorkoutExercise.restSeconds`. */
  restSeconds: number | null;
  /** Total cap for an `amrap` block ("as many rounds as possible in 12 minutes"). */
  capSeconds: number | null;
  exercises: WorkoutExercise[];
}

/**
 * One prescribed exercise inside a block -- the `workout_exercises` row.
 *
 * Which of the target fields is meaningful is decided by the referenced exercise's existing
 * `Exercise.measure` (`weight | time | distance`), which is the discriminator the whole
 * engine reads. Phase 3 deliberately does not invent a second one.
 *
 * `targetReps` / `targetRepsMax` are a range because the design prescribes ranges
 * ("4 sets x 6-8"). A single prescribed value leaves `targetRepsMax` null.
 */
export interface WorkoutExercise {
  id: string;
  blockId: string;
  /** References `exercises.id`. Soft-deleted exercises still resolve, by design. */
  exerciseId: string;
  orderIndex: number;
  /** How many sets are prescribed. `null` in a block whose `rounds` supplies the count. */
  setCount: number | null;
  targetReps: number | null;
  /** Upper bound of a prescribed rep range; `null` when a single value was prescribed. */
  targetRepsMax: number | null;
  /**
   * Always kilograms (ADR-016). `weightUnit` is a display preset converted at the screen;
   * storing what the user typed makes every later aggregate wrong.
   */
  targetWeightKg: number | null;
  /** For `measure === "time"` exercises -- the design's "3 sets x 45 s". */
  targetSeconds: number | null;
  /** Always metres, for the same reason weights are always kg -- the design's "2,000 m". */
  targetDistanceMeters: number | null;
  /** Prescribed rest after each set. The live screen's default applies when this is null. */
  restSeconds: number | null;
  notes: string | null;
}

/* ------------------------------------------------------------------------------------------
 * The session half: what the user actually did.
 *
 * `workout_sessions -> workout_session_exercises -> workout_sets`.
 * ---------------------------------------------------------------------------------------- */

/**
 * A record of a performed workout. Its `id` is **generated on the device at session start**
 * and is the idempotency key the upload is keyed by: a retried upload after a dropped
 * response returns the existing session rather than creating a second one.
 *
 * Nothing here is ever back-filled from the template. If the user was prescribed 100 kg and
 * lifted 95, the session says 95.
 */
export interface WorkoutSession {
  /** Client-generated UUID, assigned on-device at creation. Also the sync idempotency key. */
  id: string;
  userId: string;
  /** `null` for an ad-hoc session started without a template. */
  templateId: string | null;
  /**
   * Snapshotted from the template at start, because a session must still name itself after
   * its template is renamed or deleted. This is the one place a snapshot is correct: it is a
   * label, not data the template could be re-derived from.
   */
  name: string;
  activity: Activity;
  status: WorkoutSessionStatus;
  startedAt: Date;
  /** `null` while the session is `in_progress` or `paused`. */
  endedAt: Date | null;
  /**
   * Elapsed working time, excluding paused stretches -- so it is not simply
   * `endedAt - startedAt`. Rebuilt from the local event log, which is what makes it survive
   * a mid-session crash.
   */
  durationSeconds: number;
  perceivedEffort: PerceivedEffort | null;
  notes: string | null;
  /**
   * Coarse location, captured **at session start and stored on the session, never on the
   * user record** (docs/architecture/security.md) -- which is what makes "the leaderboard
   * doesn't follow you when you relocate" true by construction rather than by a rule someone
   * has to remember. `null` unless the user opted in to location for leaderboards.
   */
  city: string | null;
  citySlug: string | null;
  /**
   * Whether this session was tracked live, with real start/end timestamps, rather than
   * entered or backdated afterwards. It is the anti-cheat fact security.md's
   * `leaderboard_eligible` rests on; eligibility itself is *not* stored, because it is that
   * fact combined with the user's current privacy opt-in and is therefore evaluated at read
   * time -- a stored copy would go stale the moment consent is withdrawn.
   */
  isLiveTracked: boolean;
  exercises: WorkoutSessionExercise[];
  /**
   * Heart rate is deliberately absent. The design's summary screen shows an average, but
   * heart rate is health data with a provider of origin, so it belongs in
   * `HealthObservation` and is joined at read time (Phase 6) -- copying it onto the session
   * would lose the source, which CLAUDE.md rule 10 forbids.
   *
   * Volume, tonnage and PR flags are absent for the parallel reason: they are derived
   * aggregates, recomputed by the analytics jobs and never patched (rule 9).
   */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One exercise as it was actually performed within a session. */
export interface WorkoutSessionExercise {
  id: string;
  sessionId: string;
  /** References `exercises.id`; resolves even after a soft delete, which is why it is soft. */
  exerciseId: string;
  orderIndex: number;
  /**
   * Copied from the exercise at session start so a set can be interpreted without a join,
   * and so that changing an exercise's measure later cannot retroactively reinterpret sets
   * that were already logged as something else.
   */
  measure: ExerciseMeasure;
  notes: string | null;
  sets: WorkoutSet[];
}

/**
 * One performed set -- the leaf of the whole engine, and the row progression analytics reads.
 *
 * Which value fields are populated follows the parent's `measure`: `weight` uses
 * `weightKg` + `reps`, `time` uses `durationSeconds`, `distance` uses `distanceMeters`.
 * They are separate nullable columns rather than one polymorphic value so that a query for
 * "heaviest bench press" does not have to parse anything.
 */
export interface WorkoutSet {
  id: string;
  sessionExerciseId: string;
  /** Position within the exercise. Dense and zero-based. */
  setIndex: number;
  type: WorkoutSetType;
  /**
   * A set can exist and be unticked -- the live screen renders the prescribed sets up front
   * and the user ticks them off, so an unfinished session carries incomplete rows rather
   * than missing ones. Analytics must filter on this, not assume every row happened.
   */
  isCompleted: boolean;
  /** Always kilograms (ADR-016). */
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  /** Always metres. */
  distanceMeters: number | null;
  /** Rest actually taken after this set, from the local event log's rest events. */
  restSeconds: number | null;
  completedAt: Date | null;
}

/**
 * A single entry in the on-device append-only log (`expo-sqlite`, not Drift -- ADR-013 and
 * ADR-022 superseded `workout-engine.md`'s Drift reference). Local only: it is never
 * uploaded, because the server receives the *rebuilt* session, not the keystrokes that
 * produced it.
 *
 * `payload` is deliberately loose JSON rather than a discriminated union. Phase F defines and
 * validates each event's payload shape; pinning them here would fix the log format before the
 * screen that writes it exists.
 */
export interface WorkoutSessionEvent {
  id: string;
  sessionId: string;
  type: WorkoutEventType;
  /** Device clock at the moment the event was appended. Monotonic within a session. */
  occurredAt: Date;
  payload: Record<string, unknown>;
}

/**
 * The unit preferences a workout screen needs in order to render canonical kg/metre values.
 * Grouped here so a screen takes one prop rather than two, and so the direction of the
 * conversion stays obvious: **storage is canonical, display is converted** (ADR-016).
 */
export interface WorkoutDisplayUnits {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
}
