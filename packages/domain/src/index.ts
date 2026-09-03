/**
 * Canonical domain types. Pure TypeScript by rule: no NestJS, no Supabase, no UI framework
 * may be imported here (CLAUDE.md rules 1-2, enforced by the CI conformance check).
 */

export * from "./exercise-vocabulary";
export * from "./nutrition-vocabulary";
export * from "./workout-vocabulary";

/**
 * A **preset**, not a preference. It writes `weightUnit` and `distanceUnit` as a convenience
 * and deliberately says nothing about energy — see `ENERGY_UNITS`. It survives only because
 * removing it would be a breaking change to a shipped `/api/v1` (CLAUDE.md rule 7); it is
 * `@deprecated` on the wire and goes away in `/api/v2`.
 *
 * @see docs/decisions/ADR-016-unit-system-as-preset.md
 */
export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

/**
 * Three options by product decision (Male, Female, Rather not say), matching the three chips
 * the design actually draws. `other` was removed rather than left accepted-but-unoffered.
 *
 * This tuple used to be a bare union here *and* a separate `z.enum([...])` in
 * @forjd/contracts, and the two drifted. @forjd/contracts now builds its schema from this
 * declaration, so the drift is not merely detectable — it is unrepresentable.
 */
export const SEXES = ['male', 'female', 'prefer_not_to_say'] as const;
export type Sex = (typeof SEXES)[number];

/**
 * The closed value sets for the profile's unit preferences and its two chip lists.
 *
 * They are `as const` tuples rather than bare union types so that a single declaration
 * serves both as a TypeScript union *and* as a runtime array — which is what lets the wire
 * contracts build `z.enum(...)` from them instead of restating the values. `Sex` was
 * restated in @forjd/contracts and drifted, and slice 2 adds six more unions; duplicating
 * them would multiply a bug that has already bitten once.
 *
 * All of these are stored in `text` / `text[]` columns, never Postgres enums. Narrowing a
 * PG enum is impossible — `ALTER TYPE` cannot remove a value — whereas narrowing the tuple
 * below costs nothing, exactly as the recent `sex` narrowing did.
 */
export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const DISTANCE_UNITS = ['km', 'mi'] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

/**
 * `kJ` keeps its SI capitalisation deliberately — the symbol's case is semantic (`kJ` is
 * kilojoule, `KJ` and `kj` are neither) and it is also the literal string the design draws.
 */
export const ENERGY_UNITS = ['kcal', 'kJ'] as const;
export type EnergyUnit = (typeof ENERGY_UNITS)[number];

/**
 * Untargeted training *intents*, deliberately not the existing `goals` table, which models
 * measurable targets with a `target_value` and a `target_date`. "Get stronger" has neither,
 * and reusing that table would force both columns to hold something meaningless.
 *
 * Stored as stable slugs; the display strings ("Get stronger") live in the mobile app, so
 * copy can be reworded or translated without a migration.
 */
export const TRAINING_GOALS = [
  'get_stronger',
  'lose_fat',
  'build_muscle',
  'improve_endurance',
  'feel_better',
] as const;
export type TrainingGoal = (typeof TRAINING_GOALS)[number];

/**
 * What kind of training a thing is. Backs the profile's activity chips, `workout_templates`
 * and `workout_sessions`.
 *
 * `cross_training` was appended in Phase 3K, not inserted, so nothing reading this tuple
 * positionally shifts. It exists because two of the nine seeded programs — Engine Builder
 * (fan-bike and thruster conditioning) and Bodyweight Anywhere (progressive calisthenics) —
 * are Cross Training in the design's own catalogue, and the six members above have no home for
 * them: filing a fan-bike interval under `strength` is plainly wrong, and filing calisthenics
 * under `hyrox` labels it a race format it is not.
 *
 * **It is deliberately absent from the onboarding activity picker.** That list is the design's
 * own six chips (the prototype's `acts` array) and gains no seventh here — this tuple says what
 * the API accepts and what a template may be, not what the goals screen offers.
 */
export const ACTIVITIES = [
  'strength',
  'running',
  'hyrox',
  'pilates',
  'cycling',
  'swimming',
  'cross_training',
] as const;
export type Activity = (typeof ACTIVITIES)[number];

/**
 * Only `free` is reachable today — billing is Phase 10, so `SubscriptionService.getPlan`
 * always returns it (see apps/api/src/subscription). A one-member tuple looks like it is
 * anticipating `pro`, but it is not: it exists so the eventual second value is a data change
 * (`PLANS`, `z.enum(PLANS)`) rather than a signature change to every caller of `getPlan`,
 * matching how every other closed value set in this file is declared.
 */
export const PLANS = ['free'] as const;
export type Plan = (typeof PLANS)[number];

export interface User {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Profile {
  userId: string;
  displayName: string | null;
  /**
   * Separate from `displayName` (ADR-019): the design shows both simultaneously, so these are
   * two fields, not one rendered twice. Null for every account created before the field
   * existed -- there is no honest value to backfill.
   */
  username: string | null;
  dateOfBirth: string | null;
  sex: Sex | null;
  /** Always metric. Imperial is a display concern, converted at the edge. */
  heightCm: number | null;
  unitSystem: UnitSystem;
  /**
   * Three independent display preferences, not values derived from `unitSystem`. Deriving
   * them is lossy in both directions: `kg` with `mi` has no correct system, and `kJ` has no
   * system at all. `unitSystem` survives as a preset that writes weight and distance.
   */
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  energyUnit: EnergyUnit;
  trainingGoals: TrainingGoal[];
  activities: Activity[];
  /**
   * A city name the user volunteered, and a slug derived from it for future grouping. Coarse
   * and string-only by design — no coordinate is ever stored on the user record, because
   * docs/architecture/security.md puts location on WorkoutSession. The device reverse-geocodes
   * locally and sends the name.
   */
  city: string | null;
  citySlug: string | null;
  avatarUrl: string | null;
}

/**
 * Consent state, separated from the profile because these flags gate *server behaviour* and
 * the profile is display data. Every flag is opt-in and defaults to false, including crash
 * diagnostics — an off-by-default diagnostic is a decision, not an oversight.
 *
 * `aiFeaturesConsentAt` records when consent was granted and is nulled when it is withdrawn.
 * Only real transitions touch it, so a no-op update cannot manufacture a consent record.
 */
export interface PrivacySettings {
  userId: string;
  publicProfile: boolean;
  leaderboardOptIn: boolean;
  /** Meaningless without `leaderboardOptIn`; the service enforces that, not the database. */
  locationForLeaderboard: boolean;
  aiFeaturesConsent: boolean;
  aiFeaturesConsentAt: Date | null;
  crashDiagnostics: boolean;
}
export * from './training-calculations';

export * from './unit-conversion';
