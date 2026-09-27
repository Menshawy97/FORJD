/**
 * The closed value sets behind Weekly Forge (ADR-057). Declared as `as const` tuples, like every
 * other vocabulary in this package, so `@forjd/contracts` can build `z.enum(...)` from them and a
 * database `text` column can be checked against them.
 *
 * Nothing here depends on UI, a provider SDK, or a database (CLAUDE.md rules 1 and 2).
 */

/** The five ladders, in the order every screen lists them. */
export const FORGE_LADDERS = ['consistency', 'volume', 'distance', 'minutes', 'nourish'] as const;
export type ForgeLadder = (typeof FORGE_LADDERS)[number];

/** Lowest to highest: raw stone and iron, ember glow, forged steel, temper sheen, white-hot. */
export const FORGE_BANDS = ['ore', 'ember', 'anvil', 'tempered', 'forged'] as const;
export type ForgeBand = (typeof FORGE_BANDS)[number];

/**
 * What a ledger row records (ADR-057 decision 7).
 * - `forge_mark`: the first time a level is reached on a ladder.
 * - `band_badge`: the first entry into a band on a ladder.
 * - `forged`: every week the athlete enters Forged, first time or re-forge.
 */
export const FORGE_REWARD_TYPES = ['forge_mark', 'band_badge', 'forged'] as const;
export type ForgeRewardType = (typeof FORGE_REWARD_TYPES)[number];

/**
 * How a closed week went on one ladder.
 * - `hit`: met the target (the level rose by one, or could not rise further).
 * - `overshoot`: cleared a higher level's target and climbed two or three.
 * - `miss`: short of the target; the level holds.
 * - `drop`: the third miss in a row; the level fell by one.
 * - `cooled`: a miss while Forged; back to the top of Tempered.
 */
export const FORGE_OUTCOMES = ['hit', 'overshoot', 'miss', 'drop', 'cooled'] as const;
export type ForgeOutcome = (typeof FORGE_OUTCOMES)[number];

/** The celebration a week earns, smallest to biggest (`cooled` is gentle, never an alarm). */
export const FORGE_CELEBRATIONS = ['none', 'cooled', 'level', 'band', 'forged'] as const;
export type ForgeCelebration = (typeof FORGE_CELEBRATIONS)[number];

export const FORGE_LADDER_NAMES: Record<ForgeLadder, string> = {
  consistency: 'Consistency',
  volume: 'Volume',
  distance: 'Distance',
  minutes: 'Active minutes',
  nourish: 'Nourish',
};

export const FORGE_BAND_NAMES: Record<ForgeBand, string> = {
  ore: 'Ore',
  ember: 'Ember',
  anvil: 'Anvil',
  tempered: 'Tempered',
  forged: 'Forged',
};

/** The unit a ladder's weekly total and targets are measured in. Storage is metric (ADR-016). */
export const FORGE_LADDER_UNITS: Record<ForgeLadder, 'workouts' | 'kg' | 'km' | 'minutes' | 'days'> = {
  consistency: 'workouts',
  volume: 'kg',
  distance: 'km',
  minutes: 'minutes',
  nourish: 'days',
};

/**
 * Whether a ladder may appear on the public athlete profile. Nourish never does: it is shown only
 * on the athlete's own profile and has no share card (ADR-057 decision 8).
 */
export const FORGE_LADDER_IS_PUBLIC: Record<ForgeLadder, boolean> = {
  consistency: true,
  volume: true,
  distance: true,
  minutes: true,
  nourish: false,
};

/**
 * The forge flavour lines. Short, and never shaming: a missed week has no line of its own.
 */
export const FORGE_COPY = {
  level: 'Struck.',
  band: 'Heat rising.',
  forged: 'Forged.',
  cooled: 'Cooled to Tempered. Hold 4 weeks to re-forge.',
} as const satisfies Partial<Record<ForgeCelebration, string>>;
