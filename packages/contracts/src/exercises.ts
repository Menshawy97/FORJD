import {
  EQUIPMENT,
  EXERCISE_CATEGORIES,
  EXERCISE_GOALS,
  EXERCISE_MEASURES,
  FORCES,
  LEVELS,
  MECHANICS,
  MUSCLE_GROUPS,
} from '@forjd/domain';
import { z } from 'zod';

import { listResponseSchema } from './common';

export const exerciseCategorySchema = z.enum(EXERCISE_CATEGORIES);
export const exerciseGoalSchema = z.enum(EXERCISE_GOALS);
export const exerciseMeasureSchema = z.enum(EXERCISE_MEASURES);
export const muscleGroupSchema = z.enum(MUSCLE_GROUPS);
export const equipmentSchema = z.enum(EQUIPMENT);
export const forceSchema = z.enum(FORCES);
export const levelSchema = z.enum(LEVELS);
export const mechanicSchema = z.enum(MECHANICS);

/**
 * A query-string boolean, spelled out rather than coerced.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, and every non-empty string is truthy — so
 * `?favourite=false` would parse to `true` and quietly return the opposite of what was
 * asked, with no error anywhere. Only the two literals a client should ever send are
 * accepted; anything else is a 400 the caller can see and fix.
 */
const booleanQueryParamSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * The codebase's first `@Query` validation. Everything arrives as a string, so `limit` needs
 * `z.coerce` while the enum filters do not.
 *
 * Every filter is optional and absence means "no filter" — there is deliberately no "all"
 * sentinel value, which would give one state two spellings.
 */
export const exerciseListQuerySchema = z.object({
  /**
   * Free-text search. Trimmed, and a blank term becomes `undefined` rather than a validation
   * error: clearing the search box sends `?q=`, which means "no search", not a bad request.
   * Bounded because an unbounded term reaches a full-text query and a trigram index.
   *
   * **Trim first, then bound.** The bound protects the query that actually runs, so it has to
   * apply to the term that reaches it. Checked against the raw string instead, a search well
   * inside the limit would 400 purely because of whitespace the server was about to discard —
   * the same mistake as putting `min(1)` before the trim, in the other direction.
   */
  q: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    })
    .pipe(z.string().max(80).optional()),
  category: exerciseCategorySchema.optional(),
  muscle: muscleGroupSchema.optional(),
  equipment: equipmentSchema.optional(),
  /** `true` narrows to the caller's favourites; `false` and absence both mean "no filter". */
  favourite: booleanQueryParamSchema.optional(),
  /** Opaque. Echoed back from a previous response's `nextCursor`, never constructed. */
  cursor: z.string().max(512).optional(),
  /**
   * Bounded at 100 and rejected rather than clamped above it. Silently clamping would let a
   * client believe it had asked for 5,000 rows and received the last page when it had not.
   */
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ExerciseListQuery = z.infer<typeof exerciseListQuerySchema>;

/**
 * One row in the exercise library list.
 *
 * Written out in full rather than derived from `exerciseResponseSchema` with `.pick()`, for
 * the same reason `publicProfileResponseSchema` is: a `pick` list keeps a field out of the
 * list response only for as long as nobody adds it, and nothing fails when they do. Here the
 * cost of the derived version is not a privacy leak but a payload one — the list returns up
 * to 100 rows, and `instructions` alone would multiply its size for data no list row draws.
 *
 * `imageUrl` is the first image only. The list draws one thumbnail; sending the second image
 * of 100 exercises to render none of them is bandwidth spent on nothing.
 */
export const exerciseSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  category: exerciseCategorySchema,
  /**
   * Present in the summary because the list doubles as the picker (`pick=workout` /
   * `pick=routine`), and choosing an exercise into a workout needs to know how a set of it is
   * logged without a second round trip per row.
   */
  measure: exerciseMeasureSchema,
  primaryMuscles: z.array(muscleGroupSchema),
  equipment: z.array(equipmentSchema),
  /** Null when the exercise has no media — every custom exercise, and any catalogue gap. */
  imageUrl: z.string().nullable(),
  /**
   * True for a user-authored exercise. Says what the client needs (draw the edit affordance)
   * without publishing an owner id: the only custom exercises a caller can see are their own,
   * so the id would carry no information the caller does not already have.
   */
  isCustom: z.boolean(),
  /** Never optional — "not favourited" and "not sent" must not be the same value. */
  isFavourite: z.boolean(),
});
export type ExerciseSummary = z.infer<typeof exerciseSummarySchema>;

export const exerciseListResponseSchema = listResponseSchema(exerciseSummarySchema);
export type ExerciseListResponse = z.infer<typeof exerciseListResponseSchema>;

/**
 * A single exercise in full, for the detail screen.
 *
 * **`imageUrls`, never `imageKeys`.** The database stores storage keys and the API resolves
 * them through a configurable base URL (ADR-018), which is what makes replacing the stopgap
 * media a config change instead of a migration. That only holds while the key stays on the
 * server side of the wire: publish the key and every client is now coupled to the bucket
 * layout, and the cheap swap stops being cheap.
 *
 * No `source`, `sourceId`, `createdAt`, `updatedAt` or `deletedAt`. Nothing in the design
 * draws them, and a soft-deleted exercise is never returned at all, so `deletedAt` could
 * only ever be null here.
 */
export const exerciseResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  category: exerciseCategorySchema,
  goal: exerciseGoalSchema,
  measure: exerciseMeasureSchema,
  primaryMuscles: z.array(muscleGroupSchema),
  secondaryMuscles: z.array(muscleGroupSchema),
  equipment: z.array(equipmentSchema),
  /** Source metadata, absent on every custom exercise — hence nullable, not optional. */
  force: forceSchema.nullable(),
  level: levelSchema.nullable(),
  mechanic: mechanicSchema.nullable(),
  instructions: z.array(z.string()),
  imageUrls: z.array(z.string()),
  description: z.string().nullable(),
  isCustom: z.boolean(),
  isFavourite: z.boolean(),
});
export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>;

/**
 * Body for `POST /exercises`. **`goal` is deliberately absent.** The design's own comment
 * calls it "derived, not chosen" (`docs/design/phase2-screen-specs.md` §6.1) — computed from
 * `measure` alone (`weight` -> hypertrophy, everything else -> muscular endurance) — so
 * accepting it as a client-supplied field would let a buggy or malicious caller send a pair
 * like `measure: 'distance'` with a hypertrophy goal that nothing downstream expects to see.
 * `ExercisesService` derives it the same way the prototype's JS does, not from wire input.
 *
 * `secondaryMuscles`, `force`, `level`, `mechanic`, `instructions`, `imageKeys`, `source` and
 * `sourceId` have no field here at all: none of them are on the create/edit screen
 * (`docs/design/phase2-screen-specs.md` §6.1's field list is exhaustive), and
 * `ExercisesRepository.createCustomExercise` already fixes each to its custom-exercise
 * default (`[]`, `null`, `[]`, `[]`, `null`, `null`) rather than reading it from the input.
 */
export const createExerciseRequestSchema = z.object({
  /** Trim first, then bound -- same reasoning as `exerciseListQuerySchema.q`. */
  name: z.string().trim().min(1).max(80),
  category: exerciseCategorySchema,
  measure: exerciseMeasureSchema,
  /** "Pick at least one muscle worked" — the screen's own validation order, item 2. */
  primaryMuscles: z.array(muscleGroupSchema).min(1),
  /** "Pick at least one piece of equipment" — the screen's own validation order, item 3. */
  equipment: z.array(equipmentSchema).min(1),
  /**
   * Optional on the screen ("cues, setup or form notes"); absent, `null` and a
   * whitespace-only string are all "none". `.trim()` alone only strips edges — it does not
   * collapse `""` to nothing, so the transform below does that explicitly, the same
   * "blank means absent" idea `exerciseListQuerySchema.q` already applies to search terms.
   */
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .transform((value) => (typeof value === "string" && value.length === 0 ? undefined : value)),
});
export type CreateExerciseRequest = z.infer<typeof createExerciseRequestSchema>;

/**
 * Body for `PATCH /exercises/:id`. Every field the create screen's edit mode can change, all
 * optional -- an update sends only what changed, matching `updateProfileRequestSchema`'s and
 * `updatePrivacyRequestSchema`'s own partial shape.
 */
export const updateExerciseRequestSchema = createExerciseRequestSchema.partial();
export type UpdateExerciseRequest = z.infer<typeof updateExerciseRequestSchema>;

/**
 * Body for `GET /exercises/catalogue` (Phase H) — the whole visible set (catalogue rows plus
 * the caller's own custom exercises) in one unpaginated response, for the on-device store to
 * mirror into SQLite. Each row is the full `exerciseResponseSchema` shape, not the leaner
 * `exerciseSummarySchema` the browse list uses: workout execution reads exercises from the
 * device offline (CLAUDE.md rule 6 — the network is never in the critical path of a live
 * session), so the local mirror needs everything a detail screen would ever show, not just a
 * list row's worth.
 *
 * `catalogueVersion` is a content hash (`ExercisesService` derives it, never the client), not
 * a counter or a timestamp — it changes if and only if the set of rows or any row's content
 * actually changed, which a monotonic counter would also need but a `MAX(updatedAt))`
 * timestamp alone would not: a soft-deleted row removes itself from the visible set without
 * bumping any surviving row's `updatedAt`, and a timestamp-only version would miss that.
 * `apps/mobile/src/store/exercise-catalogue.ts` compares this against its own last-synced
 * value and skips the (comparatively expensive) SQLite rebuild and FTS5 reindex when they
 * match — not the network call itself, which every launch still makes.
 */
export const exerciseCatalogueResponseSchema = z.object({
  exercises: z.array(exerciseResponseSchema),
  catalogueVersion: z.string(),
});
export type ExerciseCatalogueResponse = z.infer<typeof exerciseCatalogueResponseSchema>;
