import {
  PERCEIVED_EFFORTS,
  WORKOUT_BLOCK_TYPES,
  WORKOUT_SESSION_STATUSES,
  WORKOUT_SET_TYPES,
} from '@forjd/domain';
import { z } from 'zod';

import { listResponseSchema } from './common';
import { exerciseMeasureSchema } from './exercises';
import { activitySchema } from './users';

// ---------------------------------------------------------------------------------------------
// Workouts (Phase 3) -- built from workout-vocabulary.ts's tuples, so a value added there
// only needs a z.enum(...) here to stay in sync; there is no second list to remember to edit.
// ---------------------------------------------------------------------------------------------

export const workoutBlockTypeSchema = z.enum(WORKOUT_BLOCK_TYPES);
export const workoutSetTypeSchema = z.enum(WORKOUT_SET_TYPES);
export const workoutSessionStatusSchema = z.enum(WORKOUT_SESSION_STATUSES);
export const perceivedEffortSchema = z.enum(PERCEIVED_EFFORTS);

/**
 * One prescribed exercise inside a create/update block. **`orderIndex` has no field here** --
 * position is the array's own index, the same choice `createSavedMealRequestSchema.items`
 * already makes, so there is exactly one way to express order and no way for a client to send
 * an index that disagrees with where the item actually sits in the array.
 *
 * **`setCount`/`targetReps`/etc. accept whatever the create screen collects; nothing here
 * checks them against the referenced exercise's `measure`.** That check needs a database
 * lookup this schema cannot perform, so it is a service-layer concern (Phase D), the same
 * division `createExerciseRequestSchema` draws around `goal`.
 */
/**
 * R22 (H16) -- `targetWeightKg`, `targetSeconds` and `targetDistanceMeters` are mutually
 * exclusive: which one is meaningful follows the referenced exercise's `measure`
 * (`weight | time | distance`), and that discriminator only ever selects one of them. This
 * schema cannot look up the exercise to confirm *which* one applies -- see the docblock below
 * -- but it can and does reject a request that sends more than one, which is never legitimate
 * regardless of measure. The audit left open whether a service-layer check exists; it does not
 * (`workouts.service.ts` copies these fields through unchecked), so this is the only place the
 * cross-field rule is enforced today.
 */
const createWorkoutExerciseInputSchema = z
  .object({
    exerciseId: z.string().uuid(),
    setCount: z.number().int().min(1).optional(),
    targetReps: z.number().int().min(1).optional(),
    targetRepsMax: z.number().int().min(1).optional(),
    /** Always kilograms (ADR-016) -- there is no unit field to disagree with it. */
    targetWeightKg: z.number().min(0).optional(),
    targetSeconds: z.number().int().min(1).optional(),
    /** Always metres, for the same reason weight is always kilograms. */
    targetDistanceMeters: z.number().min(0).optional(),
    restSeconds: z.number().int().min(0).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (exercise) =>
      [exercise.targetWeightKg, exercise.targetSeconds, exercise.targetDistanceMeters].filter(
        (target) => target !== undefined,
      ).length <= 1,
    {
      message:
        "targetWeightKg, targetSeconds and targetDistanceMeters are mutually exclusive -- only one may be set per exercise.",
      path: ["targetWeightKg"],
    },
  );

/**
 * One block inside a create/update template. `type` is the tuple built above -- an unknown
 * string (a typo, or a client built against a stale domain package) is a 400 the caller can
 * see and fix, not a value that reaches the `workout_blocks.type` column unexamined.
 */
const createWorkoutBlockInputSchema = z.object({
  type: workoutBlockTypeSchema,
  name: z.string().trim().max(80).optional(),
  rounds: z.number().int().min(1).optional(),
  workSeconds: z.number().int().min(1).optional(),
  restSeconds: z.number().int().min(0).optional(),
  capSeconds: z.number().int().min(1).optional(),
  exercises: z.array(createWorkoutExerciseInputSchema).min(1),
});

/**
 * Body for `POST /workouts/templates` (Phase D/G).
 *
 * **`basedOnTemplateId` is client-supplied, server-*validated*** -- revised from Phase D's
 * original "fully service-derived, absent from the body" design once Phase G built the real
 * "customise this preset" flow (`s_workoutDetail`'s `Customise` button) against the
 * prototype: it copies the source template's data into the builder's local state for the
 * user to edit, and only the final, edited result is ever POSTed -- so the request that
 * creates the row is the only place `basedOnTemplateId` can be attached. This mirrors the
 * precedent Phase E already shipped for `WorkoutSessionUploadRequest.templateId`: a
 * client-supplied reference the service must resolve via `findByIdForUser` before accepting
 * it (400 if the caller cannot see it), never trusted as an opaque id. What stays
 * server-derived is the *value* of a computed fact like `goal` on `createExerciseRequestSchema`
 * -- `basedOnTemplateId` is not computed from anything else in this request, it names a
 * different row the client is asserting a relationship to, which is exactly the shape a
 * validated reference takes, not a derived one.
 */
export const createWorkoutTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  activity: activitySchema,
  notes: z.string().trim().max(2000).optional(),
  estimatedDurationMinutes: z.number().int().min(1).max(600).optional(),
  basedOnTemplateId: z.string().uuid().optional(),
  blocks: z.array(createWorkoutBlockInputSchema).min(1),
});
export type CreateWorkoutTemplateRequest = z.infer<typeof createWorkoutTemplateRequestSchema>;

/**
 * Body for `PATCH /workouts/templates/:id` -- every field the builder screen's edit mode can
 * change, all optional, matching `updateExerciseRequestSchema`'s own partial shape. A partial
 * update still replaces `blocks` wholesale when sent, rather than patching one block in
 * place: the builder screen edits and re-saves the whole workout, it does not diff blocks.
 */
export const updateWorkoutTemplateRequestSchema = createWorkoutTemplateRequestSchema.partial();
export type UpdateWorkoutTemplateRequest = z.infer<typeof updateWorkoutTemplateRequestSchema>;

/** One prescribed exercise as returned inside a template's detail response. */
export const workoutExerciseResponseSchema = z.object({
  id: z.string().uuid(),
  exerciseId: z.string().uuid(),
  orderIndex: z.number().int(),
  setCount: z.number().int().nullable(),
  targetReps: z.number().int().nullable(),
  targetRepsMax: z.number().int().nullable(),
  targetWeightKg: z.number().nullable(),
  targetSeconds: z.number().int().nullable(),
  targetDistanceMeters: z.number().nullable(),
  restSeconds: z.number().int().nullable(),
  notes: z.string().nullable(),
});
export type WorkoutExerciseResponse = z.infer<typeof workoutExerciseResponseSchema>;

/** One block as returned inside a template's detail response. */
export const workoutBlockResponseSchema = z.object({
  id: z.string().uuid(),
  type: workoutBlockTypeSchema,
  orderIndex: z.number().int(),
  name: z.string().nullable(),
  rounds: z.number().int().nullable(),
  workSeconds: z.number().int().nullable(),
  restSeconds: z.number().int().nullable(),
  capSeconds: z.number().int().nullable(),
  exercises: z.array(workoutExerciseResponseSchema),
});
export type WorkoutBlockResponse = z.infer<typeof workoutBlockResponseSchema>;

/**
 * A template in full, for the builder/detail screen. **No `ownerUserId`.** Mirrors
 * `exerciseResponseSchema`'s own `isCustom` choice: the only templates a caller can see that
 * are not curated are their own, so publishing the id would carry no information the caller
 * does not already have.
 */
export const workoutTemplateResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  activity: activitySchema,
  /** Non-null when this template started as "customise this preset" -- the design's own state. */
  basedOnTemplateId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  estimatedDurationMinutes: z.number().int().nullable(),
  blocks: z.array(workoutBlockResponseSchema),
  isCustom: z.boolean(),
});
export type WorkoutTemplateResponse = z.infer<typeof workoutTemplateResponseSchema>;

/**
 * One row in the templates list ("My workouts" / a curated catalogue). Written out rather
 * than `.pick()`-derived from `workoutTemplateResponseSchema`, for the same payload reason
 * `exerciseSummarySchema` gives: the list can return many rows, and none of them need every
 * block and exercise to render "6 exercises · ~52 min".
 *
 * `exerciseCount` is computed by the service by counting `workout_exercises` rows across the
 * template's blocks -- not a stored column, so it can never drift from the blocks that
 * actually exist.
 *
 * **`basedOnTemplateId`, alongside `isCustom`**: the design's "My workouts" row (`train2.png`)
 * shows three distinct badges -- `PRESET` (curated), `CUSTOMISED PRESET` (a user's edited copy
 * of a preset), `CUSTOM` (built from scratch) -- and `isCustom` alone can only ever tell two
 * of those apart. The client derives the badge as `!isCustom -> Preset`,
 * `isCustom && basedOnTemplateId -> Customised preset`, `isCustom && !basedOnTemplateId ->
 * Custom`, never a fourth server-computed label field for what two existing booleans already
 * express.
 */
export const workoutTemplateSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  activity: activitySchema,
  estimatedDurationMinutes: z.number().int().nullable(),
  exerciseCount: z.number().int(),
  isCustom: z.boolean(),
  basedOnTemplateId: z.string().uuid().nullable(),
});
export type WorkoutTemplateSummary = z.infer<typeof workoutTemplateSummarySchema>;

export const workoutTemplateListResponseSchema = listResponseSchema(workoutTemplateSummarySchema);
export type WorkoutTemplateListResponse = z.infer<typeof workoutTemplateListResponseSchema>;

/** Query for `GET /workouts/templates`. Cursor pagination only -- see `listResponseSchema`'s own docblock for why cursor, not page number. */
export const workoutTemplateListQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type WorkoutTemplateListQuery = z.infer<typeof workoutTemplateListQuerySchema>;

/**
 * One performed set inside a session upload. **No `setIndex` field** -- position is the
 * array's own index, the same choice `createWorkoutExerciseInputSchema` makes for the same
 * reason.
 *
 * **Which of `weightKg`/`durationSeconds`/`distanceMeters` is meaningful is not enforced
 * here.** That follows the parent exercise's `measure`, which this schema does not know --
 * the service validates the pairing against the exercise it looked up (Phase E), the same
 * division of labour `createWorkoutExerciseInputSchema` draws.
 */
/**
 * R10 -- the audit's own example was 10,000 reps, accepted with no bound. Every cap below is
 * generous relative to the most extreme genuinely-recorded human performance (verified
 * powerlifting records top out under 500kg; ultramarathons run well under 200km; a single
 * uninterrupted set or rest period beyond 24 hours is not a real set) rather than a "typical"
 * workout, so no legitimate log entry is ever rejected.
 */
const workoutSetInputSchema = z.object({
  type: workoutSetTypeSchema,
  isCompleted: z.boolean(),
  weightKg: z.number().min(0).max(500).optional(),
  reps: z.number().int().min(0).max(500).optional(),
  durationSeconds: z.number().int().min(0).max(86_400).optional(),
  distanceMeters: z.number().min(0).max(200_000).optional(),
  restSeconds: z.number().int().min(0).max(86_400).optional(),
  completedAt: z.string().datetime().optional(),
});

/**
 * One exercise as performed, inside a session upload. **No `measure` field.** The session's
 * `measure` column is a snapshot of the exercise's own `measure` at the time it was
 * performed (`workouts.schema.ts`'s own docblock) -- the server takes that snapshot from the
 * `exercises` row it looks up by `exerciseId`, it does not trust a client-declared copy of a
 * fact the server already owns.
 */
const workoutSessionExerciseInputSchema = z.object({
  exerciseId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
  // .max(100): an explicit cap (R10), not the framework's ~100kb body default -- generous
  // for even a very long drop-set/AMRAP-style exercise.
  sets: z.array(workoutSetInputSchema).min(1).max(100),
});

/**
 * Body for `POST /workouts/sessions` (Phase E) -- a completed (or paused/cancelled) session,
 * uploaded once the device regains connectivity. The network is never in the critical path of
 * the live session itself (CLAUDE.md rule 6); this is the sync call that happens afterwards.
 *
 * **`id` is required, not server-assigned, and is the sync idempotency key.** It is generated
 * on the device at session start (`phase-3-plan.md`'s locked decisions), so a retried upload
 * after a dropped response is a second POST with the same `id` -- the service's job (Phase E)
 * is to return the existing session for a repeated id rather than creating a second one.
 */
export const workoutSessionUploadRequestSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  activity: activitySchema,
  status: workoutSessionStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().optional(),
  durationSeconds: z.number().int().min(0),
  perceivedEffort: perceivedEffortSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** Present only when the user has opted in to location for leaderboards. */
  city: z.string().nullable().optional(),
  citySlug: z.string().nullable().optional(),
  isLiveTracked: z.boolean(),
  // .max(100): an explicit cap (R10) -- generous for even HYROX/circuit-style sessions with
  // many distinct movements.
  exercises: z.array(workoutSessionExerciseInputSchema).max(100),
});
export type WorkoutSessionUploadRequest = z.infer<typeof workoutSessionUploadRequestSchema>;

/** One performed set, as returned in a session's detail response. */
export const workoutSetResponseSchema = z.object({
  id: z.string().uuid(),
  setIndex: z.number().int(),
  type: workoutSetTypeSchema,
  isCompleted: z.boolean(),
  weightKg: z.number().nullable(),
  reps: z.number().int().nullable(),
  durationSeconds: z.number().int().nullable(),
  distanceMeters: z.number().nullable(),
  restSeconds: z.number().int().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type WorkoutSetResponse = z.infer<typeof workoutSetResponseSchema>;

/** One exercise as performed, as returned in a session's detail response. */
export const workoutSessionExerciseResponseSchema = z.object({
  id: z.string().uuid(),
  exerciseId: z.string().uuid(),
  orderIndex: z.number().int(),
  measure: exerciseMeasureSchema,
  notes: z.string().nullable(),
  sets: z.array(workoutSetResponseSchema),
});
export type WorkoutSessionExerciseResponse = z.infer<typeof workoutSessionExerciseResponseSchema>;

/** A session in full, for the summary/history-detail screen. */
export const workoutSessionResponseSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid().nullable(),
  name: z.string(),
  activity: activitySchema,
  status: workoutSessionStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int(),
  perceivedEffort: perceivedEffortSchema.nullable(),
  notes: z.string().nullable(),
  city: z.string().nullable(),
  citySlug: z.string().nullable(),
  isLiveTracked: z.boolean(),
  exercises: z.array(workoutSessionExerciseResponseSchema),
});
export type WorkoutSessionResponse = z.infer<typeof workoutSessionResponseSchema>;

/**
 * One row in the workout history list, and what Home's stat strip / "Recent PR" (Phase J)
 * read. Written out rather than derived, for the same reason `workoutTemplateSummarySchema`
 * is: a history list can be long, and no row there needs every exercise and set.
 */
export const workoutSessionSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  activity: activitySchema,
  status: workoutSessionStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int(),
  perceivedEffort: perceivedEffortSchema.nullable(),
});
export type WorkoutSessionSummary = z.infer<typeof workoutSessionSummarySchema>;

export const workoutSessionListResponseSchema = listResponseSchema(workoutSessionSummarySchema);
export type WorkoutSessionListResponse = z.infer<typeof workoutSessionListResponseSchema>;

/** Query for `GET /workouts/sessions`. Cursor pagination only, same shape as the templates list. */
export const workoutSessionListQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type WorkoutSessionListQuery = z.infer<typeof workoutSessionListQuerySchema>;

/**
 * Query for `GET /workouts/stats` (Phase 3J-c).
 *
 * **Every figure the stats endpoint returns is a local-calendar concept** -- which month, which
 * week, which weekday -- and the server has no idea what calendar the device is on. Without an
 * explicit zone, "this month" would silently mean "this month in UTC", which is wrong for most
 * of the world for part of every day, and wrong about *which day a workout happened on* for
 * anyone far enough from Greenwich.
 *
 * It is validated rather than passed through because it reaches a `date_trunc(... AT TIME ZONE)`
 * and Postgres raises on an unknown zone name -- so an unvalidated typo would turn a 400 into
 * a 500. `Intl` is the authority here rather than a hardcoded list, which would go stale every
 * time the IANA database changes.
 */
export const workoutStatsQuerySchema = z.object({
  timeZone: z
    .string()
    .min(1)
    .max(64)
    .refine(
      (zone) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Unknown IANA time zone' },
    )
    .default('UTC'),
});
export type WorkoutStatsQuery = z.infer<typeof workoutStatsQuerySchema>;

/**
 * The athlete's current best lift, and when they first reached it.
 *
 * "Recent" is load-bearing and is not the same as "heaviest ever": this is the record whose
 * *achievement* is most recent, so an athlete who set a squat PR last week sees that rather
 * than the heavier deadlift they have held for a year. `achievedAt` is the **first** time they
 * hit that weight for that exercise, not the last -- repeating a lift does not re-set the
 * record, and treating it as though it did would make the card change for no reason.
 *
 * Weight-measured work only. There is no honest way to rank a timed hold against a lift, and
 * a card that silently mixed them would be comparing nothing.
 */
export const workoutPersonalRecordSchema = z.object({
  exerciseId: z.string().uuid(),
  exerciseName: z.string(),
  weightKg: z.number(),
  reps: z.number().int(),
  achievedAt: z.string().datetime(),
});
export type WorkoutPersonalRecord = z.infer<typeof workoutPersonalRecordSchema>;

/**
 * Response for `GET /workouts/stats` -- everything Home's stat strip, "This week" and
 * "Recent PR" need, in one request (Phase 3J-c).
 *
 * One endpoint rather than several, and computed in Postgres rather than on the device,
 * because all of these are aggregates over the athlete's whole history: the session list is
 * cursor-paginated and carries no totals, and a personal record needs every *set*, not every
 * session summary. Deriving them client-side would mean walking the entire history on every
 * Home render.
 *
 * **Counts are of completed sessions only.** An in-progress or cancelled session is not a
 * workout the athlete did, and counting one would inflate every figure here.
 */
export const workoutStatsResponseSchema = z.object({
  /** Lifetime completed sessions -- Home's "Workouts" counter. */
  totalSessions: z.number().int().min(0),
  /** Completed sessions since the first of the current local month -- "This Month". */
  sessionsThisMonth: z.number().int().min(0),
  /**
   * Consecutive weeks, ending with the current or the immediately preceding one, containing at
   * least one completed session -- Home's "Streak".
   *
   * The current week counts as *not yet missed* rather than as a break: a streak measured on
   * Monday morning would otherwise reset every week before the athlete had a chance to train.
   */
  weekStreak: z.number().int().min(0),
  thisWeek: z.object({
    sessionCount: z.number().int().min(0),
    /**
     * Which days of the current local week were trained, indexed exactly the way
     * `Date#getDay()` is -- 0 Sunday through 6 Saturday -- so the client compares it against
     * its own day index with no conversion step that could be got backwards. Ascending, and
     * distinct: two sessions on one day light one bar.
     */
    trainedWeekdays: z.array(z.number().int().min(0).max(6)),
  }),
  /** `null` before the athlete has ever completed a weighted set. */
  recentPersonalRecord: workoutPersonalRecordSchema.nullable(),
});
export type WorkoutStatsResponse = z.infer<typeof workoutStatsResponseSchema>;

/**
 * One session's top set for a single exercise -- a row of the exercise-detail screen's History
 * list, and one point of its "Top set — last 8 sessions" trend (Phase 3J-d).
 *
 * "Top set" is the heaviest completed set of that exercise *within that session*, which is what
 * the design's own rows show. Deliberately not the session's total volume: this screen's
 * subject is one exercise's progression, and a volume figure would move with how many sets were
 * done rather than with how much was lifted.
 */
export const exerciseSessionEntrySchema = z.object({
  sessionId: z.string().uuid(),
  sessionName: z.string(),
  performedAt: z.string().datetime(),
  weightKg: z.number().nullable(),
  reps: z.number().int().nullable(),
});
export type ExerciseSessionEntry = z.infer<typeof exerciseSessionEntrySchema>;

/**
 * Query for `GET /workouts/sessions/exercise/:exerciseId`. `limit` bounds the History list and
 * the trend behind it -- the design draws eight points.
 */
export const exerciseHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8),
});
export type ExerciseHistoryQuery = z.infer<typeof exerciseHistoryQuerySchema>;

/**
 * Everything the exercise-detail screen's stat tiles, trend and History list need for one
 * exercise (Phase 3J-d).
 *
 * The nullable fields are `null` for an exercise the athlete has never performed, which is what
 * keeps that screen's shipped empty states honest rather than showing zeroes that would read as
 * a real, very bad lift.
 */
export const exerciseHistoryResponseSchema = z.object({
  /** The heaviest completed set ever logged for this exercise -- the "Best set" tile. */
  bestSet: z
    .object({
      weightKg: z.number(),
      reps: z.number().int(),
      achievedAt: z.string().datetime(),
    })
    .nullable(),
  /**
   * Epley's estimate from `bestSet`, in kilograms -- the "Est. 1RM" tile.
   *
   * `null` whenever no honest estimate exists, including when a best set *does* exist but ran
   * past the rep range the formula can speak to. See `estimateOneRepMaxKg` in `@forjd/domain`.
   */
  estimatedOneRepMaxKg: z.number().nullable(),
  /** Newest first, at most `limit` long. Empty before the exercise has ever been performed. */
  sessions: z.array(exerciseSessionEntrySchema),
});
export type ExerciseHistoryResponse = z.infer<typeof exerciseHistoryResponseSchema>;
