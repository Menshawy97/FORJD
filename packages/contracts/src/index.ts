import {
  ACTIVITIES,
  DISTANCE_UNITS,
  ENERGY_UNITS,
  EQUIPMENT,
  EXERCISE_CATEGORIES,
  EXERCISE_GOALS,
  EXERCISE_MEASURES,
  FOOD_CATEGORIES,
  FORCES,
  LEVELS,
  MEAL_SLOTS,
  MECHANICS,
  MUSCLE_GROUPS,
  PERCEIVED_EFFORTS,
  PLANS,
  PROGRAM_CATEGORIES,
  PROGRAM_LEVELS,
  SEXES,
  TRAINING_GOALS,
  UNIT_SYSTEMS,
  WEIGHT_UNITS,
  WORKOUT_BLOCK_TYPES,
  WORKOUT_SESSION_STATUSES,
  WORKOUT_SET_TYPES,
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

/**
 * The prototype's own rule, verbatim (ADR-019): lowercase letters, digits, and underscores
 * only, 3-20 characters. Case-insensitive uniqueness is enforced by the database via a unique
 * index on `lower(username)`, not by this schema -- a format check cannot see other rows.
 *
 * The client sanitizes as the user types (`toLowerCase().replace(/[^a-z0-9_]/g,'')`), but that
 * is a convenience, not a constraint: this pattern is re-checked here regardless of what the
 * client already did, because a sanitizing input is not a substitute for server validation.
 */
const usernameSchema = z
  .string()
  .regex(/^[a-z0-9_]{3,20}$/, '3-20 characters: letters, numbers, underscores.');

export const profileResponseSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().nullable(),
  /**
   * Separate from `displayName` (ADR-019) -- the design shows both simultaneously
   * ("James Mitchell" above "@jmitch"), so this is a second field, not the same value
   * rendered twice. Null for every account created before this field existed; the
   * `pickUsername` onboarding screen fills it for new accounts, and existing accounts are
   * prompted from `edit-profile`, not blocked.
   */
  username: z.string().nullable(),
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
  /** Renders as `@username` on the public profile (ADR-019). Null for pre-ADR-019 accounts. */
  username: z.string().nullable(),
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
    /**
     * Format-checked here; case-insensitive uniqueness is a database constraint (ADR-019),
     * surfaced by the service as a 409 with the message `That username is taken.` on a
     * Postgres unique-violation (error code 23505) rather than as a Zod issue, because
     * uniqueness cannot be decided from the request body alone.
     */
    username: usernameSchema.nullable(),
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

/**
 * `POST /users/me/avatar`'s response (ADR-019 -- `StorageModule`'s first request-serving
 * consumer). Deliberately just the new URL, not a full `profileResponseSchema` -- the upload
 * endpoint's one job is producing a URL, and returning the whole profile back would make this
 * shape shift every time an unrelated profile field changes. The client already has the
 * `PATCH /users/me/profile` response for that; it merges this value into it.
 */
export const avatarUploadResponseSchema = z.object({
  avatarUrl: z.string(),
});
export type AvatarUploadResponse = z.infer<typeof avatarUploadResponseSchema>;

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

// ---------------------------------------------------------------------------------------------
// Nutrition (Phase 2.5, ADR-023)
// ---------------------------------------------------------------------------------------------

export const mealSlotSchema = z.enum(MEAL_SLOTS);
export const foodCategorySchema = z.enum(FOOD_CATEGORIES);

/** A plain `YYYY-MM-DD` calendar day, the client's own local date -- never server-derived. See `nutrition.schema.ts`'s docblock on `nutritionLogEntries` for why. */
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const servingSchema = z.object({
  label: z.string(),
  grams: z.number(),
});

const macroTotalsSchema = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

/**
 * A food, catalogue or custom, for both the search result row and the detail screen -- unlike
 * exercises, nothing here is heavy enough (no instructions list, no image URLs) to justify a
 * separate lean summary shape. `source`/`sourceId`/`deletedAt` never reach the wire, matching
 * `exerciseResponseSchema`'s own reasoning: nothing in the design draws them.
 */
export const foodResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: foodCategorySchema,
  macrosPer100g: macroTotalsSchema,
  servings: z.array(servingSchema),
  /** True for a user-authored food -- derived from `ownerUserId !== null`, never the id itself. */
  isCustom: z.boolean(),
});
export type FoodResponse = z.infer<typeof foodResponseSchema>;

/**
 * `GET /nutrition/foods`. No cursor: the design's food-search screen (`nutrition-screen-
 * specs.md` §3) is a narrow-as-you-type list, not an infinite-scroll browse like the exercise
 * library, so there is no "load more" affordance to page through -- unlike
 * `exerciseListQuerySchema`, a bounded `limit` is enough and `listResponseSchema`'s `nextCursor`
 * contract (a positive "no more results" statement) would be meaningless here, since
 * `NutritionRepository.searchFoods` truncates at `limit` without reporting whether more exist.
 */
export const foodSearchQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    })
    .pipe(z.string().max(80).optional()),
  category: foodCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type FoodSearchQuery = z.infer<typeof foodSearchQuerySchema>;

export const foodListResponseSchema = z.object({ items: z.array(foodResponseSchema) });
export type FoodListResponse = z.infer<typeof foodListResponseSchema>;

/**
 * Body for `POST /nutrition/foods` (a custom food). Per-100g values only, matching the design's
 * own "Enter values per 100 g" hint (`nutrition-screen-specs.md` §3) -- a serving is always
 * derived from these, never stored redundantly.
 */
export const createCustomFoodRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: foodCategorySchema,
  kcalPer100g: z.number().min(0),
  proteinPer100g: z.number().min(0),
  carbsPer100g: z.number().min(0),
  fatPer100g: z.number().min(0),
});
export type CreateCustomFoodRequest = z.infer<typeof createCustomFoodRequestSchema>;

/**
 * `{ kcal, protein, carbs, fat }`, reused for both goals and a day's totals -- the same
 * same-shape-everywhere reasoning `MacroTotals` states in `@forjd/domain`.
 */
export const macroGoalsResponseSchema = macroTotalsSchema;
export type MacroGoalsResponse = z.infer<typeof macroGoalsResponseSchema>;

/** Body for `PUT /nutrition/macro-goals`. All four required -- an upsert always writes a complete row, there is no partial-goals concept. */
export const setMacroGoalsRequestSchema = z.object({
  kcal: z.number().positive(),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
});
export type SetMacroGoalsRequest = z.infer<typeof setMacroGoalsRequestSchema>;

/**
 * A logged food entry. Macro values are the snapshot `NutritionRepository.logEntry` computed
 * and stored at log time, never a live re-computation against the food's current values --
 * `nutrition.schema.ts`'s docblock on `nutritionLogEntries` explains why (a later edit to a
 * food must not silently rewrite what a user is told they ate on a past day). No food name or
 * category here: joining that in is a later phase's job (the dashboard already has the food id
 * to look up if it needs the name), not this vertical slice's.
 */
export const nutritionLogEntryResponseSchema = z.object({
  id: z.string().uuid(),
  foodId: z.string().uuid(),
  loggedDate: localDateSchema,
  slot: mealSlotSchema,
  servingLabel: z.string(),
  grams: z.number(),
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  groupId: z.string().uuid().nullable(),
  /**
   * The saved meal's name, snapshotted at `logSavedMeal` time; `null` for an individually
   * logged item. A Phase H follow-up (`nutrition-plan.md`) -- the dashboard's collapsed-group
   * row needs a name source that `groupId` alone never provided.
   */
  groupName: z.string().nullable(),
});
export type NutritionLogEntryResponse = z.infer<typeof nutritionLogEntryResponseSchema>;

export const nutritionLogListResponseSchema = z.object({ items: z.array(nutritionLogEntryResponseSchema) });
export type NutritionLogListResponse = z.infer<typeof nutritionLogListResponseSchema>;

/**
 * Body for `POST /nutrition/log`. `servingLabel` and `grams` are supplied by the client (the
 * selected serving or a custom-amount gram value) but never a macro value -- the service
 * computes and snapshots macros server-side from the food's own per-100g values, per the
 * plan's carried-forward decision. A caller-supplied macro value would let a buggy or
 * malicious client log any calorie count against any food.
 */
export const logFoodRequestSchema = z.object({
  foodId: z.string().uuid(),
  slot: mealSlotSchema,
  loggedDate: localDateSchema,
  servingLabel: z.string().min(1),
  /** `0` is valid -- the design's "Custom amount" accepts 0 g and logs a 0-kcal entry (`nutrition-screen-specs.md` §4). */
  grams: z.number().min(0),
});
export type LogFoodRequest = z.infer<typeof logFoodRequestSchema>;

/** Body for `POST /nutrition/log/meal` -- logs every item of a saved meal, sharing one `groupId`. */
export const logSavedMealRequestSchema = z.object({
  savedMealId: z.string().uuid(),
  slot: mealSlotSchema,
  loggedDate: localDateSchema,
});
export type LogSavedMealRequest = z.infer<typeof logSavedMealRequestSchema>;

const savedMealItemSchema = z.object({
  foodId: z.string().uuid(),
  servingLabel: z.string().min(1),
  grams: z.number().min(0),
});

/** Body for `POST /nutrition/meals`. Items are copied into a day's log when the meal is logged, never referenced live -- see `NutritionRepository.logSavedMeal`'s own docblock. */
export const createSavedMealRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(savedMealItemSchema),
});
export type CreateSavedMealRequest = z.infer<typeof createSavedMealRequestSchema>;

export const savedMealResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  items: z.array(
    z.object({
      foodId: z.string().uuid(),
      servingLabel: z.string(),
      grams: z.number(),
    }),
  ),
});
export type SavedMealResponse = z.infer<typeof savedMealResponseSchema>;

export const savedMealListResponseSchema = z.object({ items: z.array(savedMealResponseSchema) });
export type SavedMealListResponse = z.infer<typeof savedMealListResponseSchema>;
export type ExerciseCatalogueResponse = z.infer<typeof exerciseCatalogueResponseSchema>;

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
const createWorkoutExerciseInputSchema = z.object({
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
});

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
const workoutSetInputSchema = z.object({
  type: workoutSetTypeSchema,
  isCompleted: z.boolean(),
  weightKg: z.number().min(0).optional(),
  reps: z.number().int().min(0).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  distanceMeters: z.number().min(0).optional(),
  restSeconds: z.number().int().min(0).optional(),
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
  sets: z.array(workoutSetInputSchema).min(1),
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
  exercises: z.array(workoutSessionExerciseInputSchema),
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
