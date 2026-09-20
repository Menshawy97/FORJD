/**
 * The closed value sets behind the city leaderboard (Phase 10). Declared as `as const` tuples,
 * like every other vocabulary in this package, so `@forjd/contracts` can build `z.enum(...)`
 * from them and a new value is a data change rather than a signature change.
 *
 * Nothing here depends on UI, a provider SDK, or a database (CLAUDE.md rules 1 and 2).
 */

/** The four chips the design's Rank screen offers, in the order it shows them. */
export const LEADERBOARD_METRICS = ["activity", "strength", "running", "hyrox"] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

/**
 * The metrics that have a real score. The others are valid requests that answer
 * `coming_soon` with no rows and no number, so a fabricated score is not representable
 * (ADR-046).
 */
export const LIVE_METRICS = ["activity"] as const satisfies readonly LeaderboardMetric[];

/** The design's "This Month / All Time" segmented control. */
export const LEADERBOARD_PERIODS = ["month", "all_time"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/** Every state the Rank screen has to render, each with its own copy. */
export const LEADERBOARD_STATUSES = [
  "ranked",
  "coming_soon",
  "not_opted_in",
  "no_city",
  "no_eligible_sessions",
  "cohort_too_small",
] as const;
export type LeaderboardStatus = (typeof LEADERBOARD_STATUSES)[number];

/**
 * A city needs at least this many eligible athletes in the window before its board is shown.
 * Below it the score is arithmetically valid and informationally worthless, and anyone on a
 * board of three can work out exactly what one other person trained (ADR-046).
 */
export const MIN_COHORT_SIZE = 5;
