import {
  ACTIVITIES,
  DISTANCE_UNITS,
  ENERGY_UNITS,
  EQUIPMENT,
  EXERCISE_CATEGORIES,
  EXERCISE_GOALS,
  EXERCISE_MEASURES,
  FORCES,
  LEVELS,
  MECHANICS,
  MUSCLE_GROUPS,
  PLANS,
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

/**
 * A volunteered, coarse city name — never a coordinate. security.md places location on
 * `WorkoutSession`, never on the user record, and a lat/long here would contradict it; the
 * device reverse-geocodes locally (`expo-location`'s `reverseGeocodeAsync`) and sends only the
 * resulting name. `citySlug` is derived from this server-side and is never itself writable —
 * see `toPatch` in `UsersService` — so a client cannot submit a slug that disagrees with the
 * name it claims to represent.
 *
 * 120 chars covers real outliers (the longest official place name in English usage, the Welsh
 * town Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch, is 58) with room to spare,
 * while still bounding what an unvalidated free-text field can cost to store and render.
 */
const citySchema = z.string().min(1).max(120);

/** Only `free` is reachable today — billing is Phase 10. See `SubscriptionService`. */
export const planSchema = z.enum(PLANS);

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
  city: citySchema.nullable(),
  avatarUrl: z.string().nullable(),
  /**
   * Never client-writable — there is no `plan` field on `updateProfileRequestSchema`. Always
   * `'free'` until Phase 10; the `editProfile` screen's Plan row renders it non-navigating.
   */
  plan: planSchema,
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

/**
 * Another athlete's profile, as seen by someone who is not them.
 *
 * **A standalone shape, deliberately not `profileResponseSchema.pick(...)`.** A derived type
 * would put adding a field to the owner's profile one keystroke away from exposing it to
 * strangers: `pick` is a list of what to keep, so a new field stays private only for as long
 * as nobody adds it to that list — and nothing fails when they do. Written out in full, a new
 * field on the owner's profile appears here only if someone types it here, in a file whose
 * name says who is going to read it.
 *
 * "Public" means visible to other signed-in FORJD users, not to the internet. The endpoint is
 * authenticated.
 *
 * No email, date of birth, sex, height, unit preferences or privacy flags. No stat tiles
 * either — the design draws them, but they need the leaderboard and analytics data that
 * arrives in phase 10, and a placeholder would be a lie with a number on it.
 */
export const publicProfileResponseSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  city: citySchema.nullable(),
  trainingGoals: z.array(trainingGoalSchema),
  activities: z.array(activitySchema),
  /**
   * True when you are looking at your own profile. Drives the design's "Your public profile"
   * self-view, and is why a private profile is still visible to its owner.
   */
  isSelf: z.boolean(),
});
export type PublicProfileResponse = z.infer<typeof publicProfileResponseSchema>;

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
    /**
     * Setting a city needs no consent flag — it is volunteered and coarse, unlike
     * `locationForLeaderboard`, which gates whether the server *uses* it for a leaderboard.
     * Sending `null` clears both `city` and its derived slug.
     */
    city: citySchema.nullable(),
    avatarUrl: httpUrlSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/* ------------------------------------------------------------------------------------------
 * Lists
 * ---------------------------------------------------------------------------------------- */

/**
 * The house envelope for every list endpoint, starting with exercises (Phase 2, Phase E).
 * Before this, every endpoint in /api/v1 returned a single object and there was no
 * pagination anywhere — so this shape is being chosen once, deliberately, rather than
 * re-invented per endpoint later.
 *
 * **Cursor, not page number.** Offset pagination re-reads the skipped rows on every page and
 * silently shifts its window when a row is inserted or removed mid-scroll: the reader sees a
 * duplicate or misses an item, and neither shows up as an error. A keyset cursor names the
 * last row seen, so the next page starts exactly where the previous one stopped regardless
 * of what changed in between.
 *
 * **`nextCursor` is required and nullable, never optional.** `null` means "this was the last
 * page" — a positive statement the client can act on. An omitted field would make "no more
 * results" and "the server forgot to send it" the same value on the wire, and a paging loop
 * that treats absence as end-of-list would silently truncate somebody's exercise library the
 * first time a serialiser dropped an undefined key.
 *
 * **No total count.** Counting the full match set costs a second query on every page for a
 * number that is stale before it is rendered, and nothing in the design displays one. Adding
 * a field later is a compatible change; removing one is not (rule 7).
 *
 * The cursor is opaque by contract: clients echo it back and never construct or parse one.
 * Its encoding is an API implementation detail and is free to change without a contract
 * version, which is only true for as long as nothing outside the API reads it.
 */
export const listResponseSchema = <TItem extends z.ZodTypeAny>(itemSchema: TItem) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });

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
