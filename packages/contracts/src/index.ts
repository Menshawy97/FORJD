import {
  ACTIVITIES,
  DISTANCE_UNITS,
  ENERGY_UNITS,
  SEXES,
  TRAINING_GOALS,
  UNIT_SYSTEMS,
  WEIGHT_UNITS,
} from '@forjd/domain';
import { z } from 'zod';

/**
 * Wire contracts for /api/v1. Schemas are the source of truth; types are inferred from them,
 * so a validator and its type can never drift apart.
 *
 * Closed value sets are imported from @forjd/domain rather than restated here. They used to
 * be written out twice — once as a domain union, once as a `z.enum([...])` — and the two
 * copies of `sex` drifted, which is a bug this package exists to prevent. Building the
 * schemas from the domain tuples makes that class of drift unrepresentable rather than
 * merely testable, which matters more now that slice 2 adds five more such sets.
 *
 * The dependency direction is deliberate and legal: domain is pure TypeScript with no
 * imports at all, so contracts depending on it cannot pull a framework or an SDK into the
 * domain layer (CLAUDE.md rules 1-2).
 */

/**
 * Mirrors the password policy configured on the Supabase project. It is duplicated here on
 * purpose: without it the API accepts a password the auth provider then rejects, and the
 * caller gets a failure with nothing actionable in it.
 *
 * Applied to registration only. Login deliberately keeps `min(1)` — validating an existing
 * password against a current policy would lock out everyone whose password predates it.
 */
const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  // Supabase's policy names an explicit symbol set, and a space is not in it. A broader
  // class such as [^A-Za-z0-9] would accept "Str0ng Pass1" here and let the provider reject
  // it instead — exactly the drift this schema exists to prevent. Found by typing a
  // space-containing password into the real signup form on a device.
  .regex(
    /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/,
    'Password must include a symbol, such as ! @ # $ %',
  );

export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: newPasswordSchema,
  /**
   * Optional so a client predating this field keeps working. The signup screen requires a
   * name; the wire contract does not. Bounds match updateProfileRequestSchema.displayName,
   * so a name accepted here cannot be rejected by the very next profile edit.
   */
  displayName: z.string().min(1).max(80).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/**
 * There is deliberately no response schema. The endpoint answers 202 with an empty body
 * whether or not the address has an account — any field describing what happened would be
 * an account-enumeration oracle for a product whose accounts hold health data.
 */
export const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * Registration does not always yield a session: when the Supabase project requires email
 * confirmation, the account exists but cannot be used until the link is clicked. Callers
 * must handle a null session rather than assume one.
 */
export const registerResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  session: sessionResponseSchema.nullable(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

/**
 * @deprecated A preset, not a preference — it writes `weightUnit` and `distanceUnit` and
 * says nothing about energy. Read `weightUnit`/`distanceUnit`/`energyUnit` instead. Retained
 * in /api/v1 because removing a shipped field is a breaking change (CLAUDE.md rule 7);
 * removed in /api/v2. See docs/decisions/ADR-016-unit-system-as-preset.md.
 */
export const unitSystemSchema = z.enum(UNIT_SYSTEMS);

/**
 * Three options by product decision: Male, Female, Rather not say. `other` was dropped
 * rather than left accepted-but-unoffered — a value no screen can produce is surface nobody
 * maintains. Safe to narrow because `sex` is a nullable `text` column, not a Postgres enum
 * (see profiles.schema.ts), so no migration is involved.
 */
export const sexSchema = z.enum(SEXES);

/** The three real unit preferences. Independent of each other and of `unitSystem`. */
export const weightUnitSchema = z.enum(WEIGHT_UNITS);
export const distanceUnitSchema = z.enum(DISTANCE_UNITS);
export const energyUnitSchema = z.enum(ENERGY_UNITS);

export const trainingGoalSchema = z.enum(TRAINING_GOALS);
export const activitySchema = z.enum(ACTIVITIES);

/**
 * Both chip lists are bounded at their own length. The bound is not about payload size — it
 * is that a request naming more members than exist can only be a duplicate-laden or
 * malformed one, and `.max()` says so at the boundary instead of letting the database store
 * an array nothing can render.
 *
 * Uniqueness is enforced too: `['strength', 'strength']` is not a different selection from
 * `['strength']`, and storing it would make the same UI state have two representations.
 */
const chipListSchema = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .array(z.enum(values))
    .max(values.length)
    .refine((list) => new Set(list).size === list.length, 'Values must be unique');

export const profileResponseSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  sex: sexSchema.nullable(),
  heightCm: z.number().nullable(),
  /** @deprecated See `unitSystemSchema`. Use the three unit fields below. */
  unitSystem: unitSystemSchema,
  weightUnit: weightUnitSchema,
  distanceUnit: distanceUnitSchema,
  energyUnit: energyUnitSchema,
  /**
   * Never null. The columns behind these are NOT NULL with an empty-array default, so
   * "nothing selected" and "never chosen" are one state and a client has two cases to handle
   * rather than three.
   */
  trainingGoals: z.array(trainingGoalSchema),
  activities: z.array(activitySchema),
  avatarUrl: z.string().nullable(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/**
 * Consent state. Separate from the profile because these gate *server behaviour* while the
 * profile is display data, and because an audit of "what did this user agree to" should read
 * one shape rather than a subset of a larger one.
 *
 * Never null and never partial: the columns behind it are NOT NULL and a row is created with
 * the account, so a client always receives all six values. A missing flag would be a third
 * state that is neither consent nor refusal.
 */
export const privacySettingsResponseSchema = z.object({
  publicProfile: z.boolean(),
  leaderboardOptIn: z.boolean(),
  locationForLeaderboard: z.boolean(),
  aiFeaturesConsent: z.boolean(),
  /** When consent was granted; null whenever `aiFeaturesConsent` is false. */
  aiFeaturesConsentAt: z.string().datetime().nullable(),
  crashDiagnostics: z.boolean(),
});
export type PrivacySettingsResponse = z.infer<typeof privacySettingsResponseSchema>;

/**
 * `aiFeaturesConsentAt` is deliberately absent — it is derived from the transition, never
 * supplied. Letting a client send it would let it claim a consent date it did not have.
 */
export const updatePrivacyRequestSchema = z
  .object({
    publicProfile: z.boolean(),
    leaderboardOptIn: z.boolean(),
    /**
     * Requires `leaderboardOptIn`. Turning this on without its parent is a 400 rather than a
     * silent coercion, because silently ignoring it would hide a client bug behind a
     * successful response — on a location field, of all things.
     */
    locationForLeaderboard: z.boolean(),
    aiFeaturesConsent: z.boolean(),
    crashDiagnostics: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdatePrivacyRequest = z.infer<typeof updatePrivacyRequestSchema>;

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  profile: profileResponseSchema.nullable(),
  /**
   * Privacy rides along here on purpose. There is deliberately **no** `GET /users/me/privacy`:
   * the settings screen needs one read, and a second endpoint would be a second source for
   * one truth, free to disagree with this one.
   */
  privacy: privacySettingsResponseSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * A shape check alone lets 2026-13-40 through Zod and fail later as a Postgres cast error,
 * surfacing as a 500 instead of a validation message. Round-tripping through Date rejects
 * impossible dates at the boundary where the caller can act on it.
 */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'Not a real calendar date');

/**
 * Restricted to http(s). z.string().url() accepts anything URL can parse, including
 * javascript: and data:, which would become a stored payload the moment a client renders
 * the avatar.
 */
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Must be an http(s) URL');

export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).max(80).nullable(),
    dateOfBirth: isoDateSchema.nullable(),
    sex: sexSchema.nullable(),
    heightCm: z.number().positive().max(300).nullable(),
    /**
     * @deprecated Sending this sets `weightUnit` and `distanceUnit` and leaves `energyUnit`
     * alone. An explicit unit in the same request wins over the preset; sending only
     * explicit units never back-derives this field, because `kg` with `mi` belongs to no
     * system and any answer would be invented. See ADR-016.
     */
    unitSystem: unitSystemSchema,
    weightUnit: weightUnitSchema,
    distanceUnit: distanceUnitSchema,
    energyUnit: energyUnitSchema,
    /**
     * Not nullable: an empty array clears the selection. Allowing null as well would give
     * "none selected" two spellings for a distinction the product does not make.
     */
    trainingGoals: chipListSchema(TRAINING_GOALS),
    activities: chipListSchema(ACTIVITIES),
    avatarUrl: httpUrlSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
