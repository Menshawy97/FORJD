import {
  ACTIVITIES,
  isOldEnough,
  MINIMUM_AGE_YEARS,
  DISTANCE_UNITS,
  ENERGY_UNITS,
  PLANS,
  SEXES,
  TRAINING_GOALS,
  UNIT_SYSTEMS,
  WEIGHT_UNITS,
} from '@forjd/domain';
import { z } from 'zod';

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

const localTodayIso = (): string => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/**
 * ADR-042. A stored date of birth must make the holder at least `MINIMUM_AGE_YEARS` old, so
 * editing a profile can never walk around the gate the sign-up flow enforces. `null` is not
 * accepted either: a date of birth, once given, cannot be cleared.
 */
const adultDateOfBirthSchema = isoDateSchema.refine(
  (value) => isOldEnough(value, new Date()),
  `You must be at least ${MINIMUM_AGE_YEARS} years old to use FORJD.`,
);

/**
 * `PUT /users/me/date-of-birth`: the one-time age check. Deliberately does not judge the age --
 * an under-age answer must delete the account (a decision for the service, not a 400), so only
 * a real, non-future calendar date is refused here.
 */
export const setDateOfBirthRequestSchema = z.object({
  dateOfBirth: isoDateSchema.refine((value) => value <= localTodayIso(), 'Date of birth cannot be in the future'),
});
export type SetDateOfBirthRequest = z.infer<typeof setDateOfBirthRequestSchema>;

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
    dateOfBirth: adultDateOfBirthSchema,
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
