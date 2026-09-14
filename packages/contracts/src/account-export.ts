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
export const accountExportSchema = z.object({
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
