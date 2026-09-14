import { PROGRAM_CATEGORIES, PROGRAM_LEVELS } from '@forjd/domain';
import { z } from 'zod';

import { activitySchema } from './users';

/* ------------------------------------------------------------------------------------------
 * Programs (Phase 3K). A program is a named, multi-week plan the athlete follows: it groups
 * several workouts, one of them is recommended next, and Home and Train both change while one
 * is active. See docs/product/phase-3k-plan.md.
 * ---------------------------------------------------------------------------------------- */

export const programCategorySchema = z.enum(PROGRAM_CATEGORIES);
export const programLevelSchema = z.enum(PROGRAM_LEVELS);

/**
 * Which programs `GET /programs` should return.
 *
 * The design has two lists and they must not bleed into each other: the catalogue screen shows
 * only the nine presets, and Train's "My programs" shows only the athlete's own. Making
 * `preset` the default means the catalogue's call is the plain one — a screen cannot
 * accidentally show a custom program among the presets by forgetting a parameter.
 */
export const programScopeSchema = z.enum(['preset', 'mine', 'all']);
export type ProgramScope = z.infer<typeof programScopeSchema>;

/**
 * Query for `GET /programs`.
 *
 * **No cursor.** Nine presets, plus however few programs an athlete builds; a keyset cursor
 * here would be machinery with no caller, and the catalogue renders the whole filtered list in
 * one column regardless. Adding pagination later is an additive change to this schema; removing
 * it would not be.
 */
export const programListQuerySchema = z.object({
  /** The catalogue's own filter chips. Absent means "All". */
  category: programCategorySchema.optional(),
  scope: programScopeSchema.default('preset'),
});
export type ProgramListQuery = z.infer<typeof programListQuerySchema>;

/**
 * One row of the program catalogue.
 *
 * `daysPerWeek` and `durationWeeks` are sent as numbers, not as the design's rendered
 * `4 days · 8 weeks` string: the screen formats it, and a server that shipped the sentence
 * would have to know the reader's language to change it later.
 *
 * `workoutCount` is here because the overview is a separate request and the list should not
 * have to make it to say how many workouts a program has. It is *not* `daysPerWeek` restated —
 * they happen to be equal for every seeded preset, and a custom program with two rest days
 * assigned would separate them.
 */
export const programSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  category: programCategorySchema,
  level: programLevelSchema,
  daysPerWeek: z.number().int(),
  durationWeeks: z.number().int(),
  description: z.string().nullable(),
  /** `true` for a program the caller built, `false` for a catalogue preset. */
  isOwn: z.boolean(),
  workoutCount: z.number().int(),
});
export type ProgramSummary = z.infer<typeof programSummarySchema>;

export const programListResponseSchema = z.object({
  items: z.array(programSummarySchema),
});
export type ProgramListResponse = z.infer<typeof programListResponseSchema>;

/**
 * One workout inside a program, as the overview screen's rows draw it.
 *
 * `templateId` rather than a bare id, and named for what it is: a program's workout **is** a
 * `workout_templates` row, which is what lets the overview's Start button reuse the existing
 * live-session handoff instead of adding a second path into it.
 *
 * `exerciseNames` is the design's own `exs.join(' · ')` line. Names, not full exercise objects:
 * the row prints them and nothing else, and a program of six workouts would otherwise carry
 * every instruction of every exercise in it.
 */
export const programWorkoutSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string(),
  activity: activitySchema,
  orderIndex: z.number().int(),
  /**
   * `0`–`6`, indexed like `Date#getDay()`. **`null` for a preset**, which prescribes a set of
   * workouts rather than a calendar — only the builder's custom programs pin one to a weekday.
   */
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  exerciseNames: z.array(z.string()),
});
export type ProgramWorkout = z.infer<typeof programWorkoutSchema>;

/** The program overview screen: everything `s_programOverview` draws above its buttons. */
export const programResponseSchema = programSummarySchema.extend({
  /**
   * Bumped whenever the program's content is rewritten. Exposed because an enrolment records
   * the version it began under, and a client comparing the two is how "this program has changed
   * since you started it" ever becomes sayable.
   */
  version: z.number().int(),
  workouts: z.array(programWorkoutSchema),
});
export type ProgramResponse = z.infer<typeof programResponseSchema>;

/**
 * `GET /programs/enrollment` — the one active enrolment, or `null`.
 *
 * Singular, because the design assumes it throughout: `activeProgram` is a single value and
 * Train renders one "Currently following:" chip. The rule is enforced in the service and, as
 * defence in depth, by a partial unique index (CLAUDE.md rule 12).
 */
export const programEnrollmentSchema = z.object({
  id: z.string().uuid(),
  programId: z.string().uuid(),
  programSlug: z.string(),
  programName: z.string(),
  /**
   * The version of the program this enrolment began under, snapshotted at enrolment.
   *
   * Phase K does **not** serve an enrollee their enrolled version's *content* — that needs
   * per-version content rows. This field records which version they joined, so the gap is
   * visible rather than pretended away.
   */
  programVersion: z.number().int(),
  startedAt: z.string().datetime(),
});
export type ProgramEnrollment = z.infer<typeof programEnrollmentSchema>;

export const programEnrollmentResponseSchema = z.object({
  enrollment: programEnrollmentSchema.nullable(),
});
export type ProgramEnrollmentResponse = z.infer<typeof programEnrollmentResponseSchema>;

/**
 * `POST /programs/:id/enrol` — the design's "Start Following".
 *
 * No request body: the program is named by the path, and there is nothing else to choose. The
 * response is the same envelope `GET /programs/enrollment` returns, minus the nullability —
 * enrolling either produces an enrolment or fails, so a client never has to branch on null here.
 *
 * **Enrolling while already following something else is not an error.** It ends the previous
 * enrolment and starts the new one, in one transaction: the design's Start Following has no "you
 * must stop the other one first" step, and a screen that had to discover the rule by being
 * refused would be a worse screen.
 */
export const programEnrolResponseSchema = z.object({
  enrollment: programEnrollmentSchema,
});
export type ProgramEnrolResponse = z.infer<typeof programEnrolResponseSchema>;

/**
 * `POST /programs` — `s_programBuilder()`'s "Save Program" (Phase 3K6).
 *
 * **No `category` or `level`.** The builder screen never asks for either — it only collects a
 * name, a week count, and which of the athlete's own workouts fall on which weekday — so there
 * is nothing honest to validate here. The service fills both with a fixed default; a custom
 * program has never had a "browse by category" reader; only the catalogue's nine presets do.
 *
 * **Each entry names a `dayOfWeek`, never `null`.** A preset's `program_workouts.day_of_week`
 * is null because it prescribes a set of workouts, not a calendar — but the builder's whole
 * premise is pinning workouts to weekdays, so an entry that skipped one would silently defeat
 * the "Weekly schedule" the screen just built. A rest day is not a row at all: the builder never
 * sends one, matching `assigned=Object.values(np.assign).filter(v=>v&&v!=='REST')`.
 *
 * **At least one workout, and `templateId`s are not deduplicated here.** The screen already
 * refuses to submit with none (`if(!np.name||!assigned.length)`); the service is where a
 * template id gets checked against the caller's own visibility, not this schema.
 */
export const createProgramWorkoutSchema = z.object({
  templateId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
});

export const createProgramRequestSchema = z.object({
  name: z.string().trim().min(1),
  durationWeeks: z.number().int().min(1),
  workouts: z.array(createProgramWorkoutSchema).min(1),
});
export type CreateProgramRequest = z.infer<typeof createProgramRequestSchema>;
