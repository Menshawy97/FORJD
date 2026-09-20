/**
 * The Activity score behind the city leaderboard (Phase 10, ADR-046).
 *
 * **This is an in-app participation metric, not a fitness assessment.** It asserts nothing
 * about health, recovery, or what anyone should do next, which is why it needs no evidence
 * base beyond the published targets it measures against. It is a plain calculation and is not
 * "AI" (ADR-030).
 *
 * Two layers, 100 points in total:
 *
 * 1. **WHO adherence, 0-70, absolute.** Measured against the World Health Organization's 2020
 *    adult guidelines (Bull et al., Br J Sports Med 2020;54:1451-1462): 150-300 minutes of
 *    activity a week, and muscle-strengthening on two or more days a week. Absolute, so it
 *    means the same thing in a city of six people and a city of six thousand. The app records
 *    no intensity, so logged working time of any kind stands in for WHO's moderate-intensity
 *    minutes; the time spent lifting therefore counts on the aerobic axis as well as the
 *    strength one. That is an approximation, stated in ADR-046, not a clinical claim.
 * 2. **Work done, 0-30, relative.** Kilograms lifted, kilometres covered and hours worked are
 *    each percentile-ranked inside the city, and the athlete takes their best. No exchange
 *    rate between kilograms and kilometres is invented, so a runner and a lifter are both
 *    scored on what they actually do and nobody scores zero for training a way the app
 *    supports.
 *
 * Every input is something the athlete logged. Self-rated effort is deliberately absent: it is
 * the best-validated training-load measure (Foster et al. 2001), but it is self-reported, so on
 * a competitive board anyone could mark every session "brutal" and climb.
 *
 * The weights are a product judgement anchored to the WHO targets, not a scientific claim.
 */

import { MIN_COHORT_SIZE } from "./leaderboard-vocabulary";

/** How the 100 points are split. The sum is asserted in the spec. */
export const ACTIVITY_WEIGHTS = {
  aerobic: 40,
  aerobicBonus: 10,
  strength: 20,
  work: 30,
} as const;

/** WHO 2020: the lower bound of the 150-300 minute band, per week. */
export const WHO_AEROBIC_MINUTES_PER_WEEK = 150;

/** WHO 2020: muscle-strengthening on at least this many days a week. */
export const WHO_STRENGTH_DAYS_PER_WEEK = 2;

/**
 * No single session counts for more than two hours. An anti-gaming bound, not science: it stops
 * a session left running for nine paused hours from earning a week of credit.
 */
export const ACTIVITY_SESSION_CAP_SECONDS = 2 * 60 * 60;

export interface AthleteActivityInput {
  userId: string;
  /** Already capped per session; see {@link cappedWorkingMinutes}. */
  workingMinutes: number;
  /** Distinct local days carrying at least one completed weighted set. */
  strengthDays: number;
  /** Sum of weight x reps over completed sets, in kilograms. */
  volumeKg: number;
  /** Sum of distance over completed sets, in kilometres. */
  distanceKm: number;
  /** Length of the window this athlete is scored over, in weeks. */
  weeks: number;
  /** Start of the athlete's earliest eligible session in the window, epoch milliseconds. */
  firstStartedAtMs: number;
}

export interface RankKey {
  userId: string;
  score: number;
  strengthDays: number;
  workingMinutes: number;
  firstStartedAtMs: number;
}

export interface RankedAthlete extends RankKey {
  /** 1-based, a total order: no two athletes share a rank. */
  rank: number;
}

/** Sessions in seconds to capped working minutes. Negative and non-finite durations count for nothing. */
export function cappedWorkingMinutes(durationsSeconds: readonly number[]): number {
  let seconds = 0;
  for (const duration of durationsSeconds) {
    if (!Number.isFinite(duration) || duration <= 0) continue;
    seconds += Math.min(duration, ACTIVITY_SESSION_CAP_SECONDS);
  }
  return seconds / 60;
}

/** The absolute layer, 0-70. A window shorter than one week is treated as one week. */
export function whoAdherencePoints(input: {
  workingMinutes: number;
  strengthDays: number;
  weeks: number;
}): number {
  const weeks = Math.max(1, input.weeks);
  const aerobicTarget = WHO_AEROBIC_MINUTES_PER_WEEK * weeks;
  const aerobicRatio = Math.max(0, input.workingMinutes) / aerobicTarget;
  const aerobic = ACTIVITY_WEIGHTS.aerobic * Math.min(1, aerobicRatio);
  const bonus = ACTIVITY_WEIGHTS.aerobicBonus * Math.min(1, Math.max(0, aerobicRatio - 1));
  const strengthRatio = Math.max(0, input.strengthDays) / (WHO_STRENGTH_DAYS_PER_WEEK * weeks);
  const strength = ACTIVITY_WEIGHTS.strength * Math.min(1, strengthRatio);
  return aerobic + bonus + strength;
}

const isPositive = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * Where `value` sits among the athletes who did some of this, counting half of any tie. The
 * result is below 1 by construction: the top of five is 0.9, not 1.
 *
 * Zeros are left out of the cohort rather than counted as "fewer". Otherwise the rarer a
 * modality was in a city, the cheaper its points: one person logging 100 m among ten lifters
 * would outrank all ten on distance. A value of zero, or one that is not a finite positive
 * number, is always 0.
 *
 * This is the plain O(n) definition, kept as the reference {@link percentileRanker} is
 * checked against.
 */
export function midRankPercentile(value: number, cohort: readonly number[]): number {
  if (!isPositive(value)) return 0;
  let participants = 0;
  let fewer = 0;
  let tied = 0;
  for (const other of cohort) {
    if (!isPositive(other)) continue;
    participants += 1;
    if (other < value) fewer += 1;
    else if (other === value) tied += 1;
  }
  return participants === 0 ? 0 : (fewer + 0.5 * tied) / participants;
}

/** First index in the ascending `sorted` whose element is >= `target`. */
function lowerBound(sorted: readonly number[], target: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sorted[mid] as number) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** First index in the ascending `sorted` whose element is > `target`. */
function upperBound(sorted: readonly number[], target: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sorted[mid] as number) <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The same numbers as {@link midRankPercentile}, computed by sorting the cohort once and
 * binary-searching, so scoring a city is O(n log n) rather than O(n^2) (about 2.7 s of
 * blocking CPU for 10,000 athletes the naive way).
 *
 * A modality that fewer than `minParticipants` athletes did at all scores nothing for anyone:
 * a handful of people is not a cohort to be ranked against, and it is what stops a token
 * effort in a rare modality from collecting most of the work points.
 */
export function percentileRanker(
  cohort: readonly number[],
  minParticipants: number = MIN_COHORT_SIZE,
): (value: number) => number {
  const positives = cohort.filter(isPositive).sort((a, b) => a - b);
  if (positives.length < minParticipants || positives.length === 0) return () => 0;
  return (value) => {
    if (!isPositive(value)) return 0;
    const fewer = lowerBound(positives, value);
    const tied = upperBound(positives, value) - fewer;
    return (fewer + 0.5 * tied) / positives.length;
  };
}

/** Best first: score, then strength days, then working minutes, then earlier start, then user id. */
export function compareForRank(a: RankKey, b: RankKey): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.strengthDays !== b.strengthDays) return b.strengthDays - a.strengthDays;
  if (a.workingMinutes !== b.workingMinutes) return b.workingMinutes - a.workingMinutes;
  if (a.firstStartedAtMs !== b.firstStartedAtMs) return a.firstStartedAtMs - b.firstStartedAtMs;
  if (a.userId === b.userId) return 0;
  return a.userId < b.userId ? -1 : 1;
}

/**
 * Rounds half up to one decimal. The small epsilon absorbs float noise: 30 * 0.045 * 10 is
 * 13.499999999999998, which would otherwise round down and split two athletes by arithmetic
 * accident rather than by the rule the ranking is documented to follow.
 */
export function roundToTenth(value: number): number {
  return Math.round(value * 10 + 1e-9) / 10;
}

const nonNegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

/**
 * A row with a NaN or infinite field would make {@link compareForRank} return NaN, which a
 * sort treats as "equal to everything" and so corrupts the whole board's order. Bad numbers
 * are made harmless here instead: they count as nothing done, and a missing start time sorts
 * last.
 */
function sanitized(athlete: AthleteActivityInput): AthleteActivityInput {
  return {
    userId: athlete.userId,
    workingMinutes: nonNegative(athlete.workingMinutes),
    strengthDays: nonNegative(athlete.strengthDays),
    volumeKg: nonNegative(athlete.volumeKg),
    distanceKm: nonNegative(athlete.distanceKm),
    weeks: Number.isFinite(athlete.weeks) ? athlete.weeks : 1,
    firstStartedAtMs: Number.isFinite(athlete.firstStartedAtMs)
      ? athlete.firstStartedAtMs
      : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Scores and ranks a whole city. Pure: the input is not modified.
 *
 * The work layer reaches 30 only in the limit: the top of a cohort of n has percentile
 * (n - 0.5) / n, so a city of five tops out at 27 work points. The `Math.min(100, ...)` is a
 * safety bound, not a reachable ceiling.
 */
export function scoreCohort(athletes: readonly AthleteActivityInput[]): RankedAthlete[] {
  const clean = athletes.map(sanitized);
  const volumeRank = percentileRanker(clean.map((a) => a.volumeKg));
  const distanceRank = percentileRanker(clean.map((a) => a.distanceKm));
  const minutesRank = percentileRanker(clean.map((a) => a.workingMinutes));

  const scored: RankKey[] = clean.map((athlete) => {
    const work =
      ACTIVITY_WEIGHTS.work *
      Math.max(
        volumeRank(athlete.volumeKg),
        distanceRank(athlete.distanceKm),
        minutesRank(athlete.workingMinutes),
      );
    const total = Math.min(100, whoAdherencePoints(athlete) + work);
    return {
      userId: athlete.userId,
      score: roundToTenth(total),
      strengthDays: athlete.strengthDays,
      workingMinutes: athlete.workingMinutes,
      firstStartedAtMs: athlete.firstStartedAtMs,
    };
  });

  return [...scored].sort(compareForRank).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * The rows to show around an athlete: `window` above and below, so ranks 44-50 for the 47th with a
 * window of 3. Near either end the window slides instead of shrinking, so the list keeps its
 * height (the 2nd shows 1-7, not 1-5), and a city smaller than the window shows everyone.
 */
export function rankWindow(rank: number, cohortSize: number, window: number): { from: number; to: number } {
  const span = 2 * window + 1;
  if (cohortSize <= span) return { from: 1, to: cohortSize };
  const from = Math.min(Math.max(1, rank - window), cohortSize - span + 1);
  return { from, to: from + span - 1 };
}

/** "Top 8%". Never below 1, so the leader does not read "Top 0%"; an empty cohort reads 100. */
export function topPercent(rank: number, cohortSize: number): number {
  return Math.max(1, Math.ceil((100 * rank) / Math.max(1, cohortSize)));
}
