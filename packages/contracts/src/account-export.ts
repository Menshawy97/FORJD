import { EXTERNAL_CONNECTION_PROVIDERS, EXTERNAL_CONNECTION_STATUSES } from '@forjd/domain';
import { z } from 'zod';

import { bodyScanResponseSchema } from './body';
import { healthObservationResponseSchema } from './health';
import { nutritionLogEntryResponseSchema } from './nutrition';
import { programEnrollmentSchema, programSummarySchema } from './programs';
import { privacySettingsResponseSchema, profileResponseSchema } from './users';
import { workoutSessionResponseSchema, workoutTemplateResponseSchema } from './workouts';

// ---------------------------------------------------------------------------------------------
// Account export (R4 / GDPR Art. 15 & 20). `GET /users/me` only ever returned profile and
// privacy -- there was no way for an athlete to get a full copy of everything else FORJD holds
// about them. This section is that copy, built entirely out of response shapes this file
// already defines, so an export can never describe a field the live API does not.
// ---------------------------------------------------------------------------------------------

/**
 * One `external_connections` row, as it may leave the API in an export. **Never** the encrypted
 * token columns -- an export is a copy of the user's own data, not of FORJD's key material, and
 * a WHOOP access/refresh token is not "the user's data" in the GDPR Art. 15/20 sense any more
 * than a password hash would be. `provider`/`status` reuse `@forjd/domain`'s own closed
 * vocabularies (`external-connection-vocabulary.ts`) rather than restating them as bare
 * strings, the same drift-proofing every other enum in this file already gets.
 */
export const accountExportConnectionSchema = z.object({
  provider: z.enum(EXTERNAL_CONNECTION_PROVIDERS),
  status: z.enum(EXTERNAL_CONNECTION_STATUSES),
  externalUserId: z.string().nullable(),
  lastSyncAt: z.string().datetime().nullable(),
});
export type AccountExportConnection = z.infer<typeof accountExportConnectionSchema>;

/**
 * The athlete's own programs: everything `isOwn` on `programSummarySchema` would mark `true`,
 * plus the one active enrolment (`null` when following nothing) -- `programEnrollmentSchema`
 * already carries the enrolled program's own id/slug/name, so a caller reading only `owned`
 * would still be missing the fact of following a *preset* they did not author.
 */
export const accountExportProgramsSchema = z.object({
  owned: z.array(programSummarySchema),
  enrollment: programEnrollmentSchema.nullable(),
});
export type AccountExportPrograms = z.infer<typeof accountExportProgramsSchema>;

/**
 * Phase 8 / 8C: the tables the first export (R4) left out. Deliberately plain scalar shapes
 * built for a human-readable copy of the user's own data -- not the live read endpoints'
 * shapes, which are paginated and enriched for screens. Numeric columns are numbers here
 * (Postgres `numeric` arrives as a string), dates are ISO-8601 strings.
 */
export const accountExportCustomExerciseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  goal: z.string(),
  measure: z.string(),
  primaryMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
  equipment: z.array(z.string()),
  instructions: z.array(z.string()),
  description: z.string().nullable(),
});
export type AccountExportCustomExercise = z.infer<typeof accountExportCustomExerciseSchema>;

export const accountExportCustomFoodSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.string(),
  kcalPer100g: z.number(),
  proteinPer100g: z.number(),
  carbsPer100g: z.number(),
  fatPer100g: z.number(),
  servings: z.array(z.object({ label: z.string(), grams: z.number() })),
});
export type AccountExportCustomFood = z.infer<typeof accountExportCustomFoodSchema>;

export const accountExportSavedMealSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  items: z.array(z.object({ foodId: z.string().uuid(), servingLabel: z.string(), grams: z.number() })),
});
export type AccountExportSavedMeal = z.infer<typeof accountExportSavedMealSchema>;

export const accountExportGoalSchema = z.object({
  type: z.string(),
  targetValue: z.number().nullable(),
  targetDate: z.string().nullable(),
  status: z.string(),
});
export type AccountExportGoal = z.infer<typeof accountExportGoalSchema>;

export const accountExportHealthConnectionSchema = z.object({
  source: z.string(),
  lastSuccessfulSyncAt: z.string().datetime().nullable(),
});
export type AccountExportHealthConnection = z.infer<typeof accountExportHealthConnectionSchema>;

export const accountExportEnrollmentHistorySchema = z.object({
  id: z.string().uuid(),
  programId: z.string().uuid(),
  programVersion: z.number().int(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
export type AccountExportEnrollmentHistory = z.infer<typeof accountExportEnrollmentHistorySchema>;

/** Everything in the export that comes from `AccountExportExtrasRepository` (8C). */
export const accountExportExtrasSchema = z.object({
  customExercises: z.array(accountExportCustomExerciseSchema),
  favouriteExerciseIds: z.array(z.string().uuid()),
  customFoods: z.array(accountExportCustomFoodSchema),
  macroGoals: z
    .object({ kcal: z.number(), protein: z.number(), carbs: z.number(), fat: z.number() })
    .nullable(),
  savedMeals: z.array(accountExportSavedMealSchema),
  goals: z.array(accountExportGoalSchema),
  preferences: z
    .object({
      timezone: z.string().nullable(),
      locale: z.string().nullable(),
      notificationsEnabled: z.boolean(),
    })
    .nullable(),
  healthConnections: z.array(accountExportHealthConnectionSchema),
  programEnrollmentHistory: z.array(accountExportEnrollmentHistorySchema),
});
export type AccountExportExtras = z.infer<typeof accountExportExtrasSchema>;

/**
 * `GET /users/me/export` -- a full, single-file copy of everything FORJD holds about the
 * authenticated caller, across every table the audit's account-deletion orphan check
 * (`users-deletion.e2e-spec.ts`) also walks. Composed entirely from schemas this file already
 * defines for the live read endpoints (health observations, body scans, nutrition log entries,
 * workout templates/sessions, programs, privacy settings) -- an export can never drift into
 * describing a shape the corresponding `GET` endpoint does not actually return, because there
 * is only one schema for each of those shapes, not two that could disagree.
 *
 * **`version` is a literal, not a bare number**, so a client (or a human reading the JSON file
 * this becomes) can tell at a glance which shape they are holding, and so a future breaking
 * change to this export bumps the literal rather than silently reinterpreting old exports under
 * a new shape. Bump it, and add a new literal to the union, the day this shape's fields change
 * in a way that is not purely additive.
 *
 * **Every array is unbounded here on purpose** -- the deliberate, documented exception to R8's
 * "every read is bounded" rule (see `HealthDataRepository.getAllObservationsForExport`'s own
 * docblock). An export exists specifically to be complete; a paginated export would not be one.
 */
export const accountExportSchema = accountExportExtrasSchema.extend({
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  account: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
  }),
  profile: profileResponseSchema.nullable(),
  privacy: privacySettingsResponseSchema,
  healthObservations: z.array(healthObservationResponseSchema),
  bodyScans: z.array(bodyScanResponseSchema),
  nutritionLogEntries: z.array(nutritionLogEntryResponseSchema),
  workoutTemplates: z.array(workoutTemplateResponseSchema),
  workoutSessions: z.array(workoutSessionResponseSchema),
  programs: accountExportProgramsSchema,
  externalConnections: z.array(accountExportConnectionSchema),
});
export type AccountExportResponse = z.infer<typeof accountExportSchema>;
