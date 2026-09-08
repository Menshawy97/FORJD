/**
 * Readiness score — ADR-031's accepted methodology.
 *
 * **This is not WHOOP's algorithm, and does not claim to be.** WHOOP's exact scoring formula
 * (how HRV/RHR/sleep/respiratory rate combine into one 0-100 number) is proprietary and has
 * never been published — their own developer docs return the score and the raw metrics, never
 * the combination logic (developer.whoop.com/docs/developing/user-data/recovery). What *is*
 * published, and what this file is built from:
 *
 * - **HRV log-transform**: rMSSD is not normally distributed; averaging/SD on `ln(rMSSD)`
 *   rather than the raw value is standard practice in HRV-guided training research (Plews et
 *   al. 2013, PubMed 23852425).
 * - **7-day smoothing**: a single day's HRV is too noisy to trust on its own; a rolling 7-day
 *   mean is the accepted daily value (Plews et al., same source).
 * - **The athlete's own rolling baseline, never a population norm** — universal across WHOOP,
 *   Oura, and the academic literature; not one of them scores against "normal for your age."
 * - **"Smallest worthwhile change" (SWC)**: Hopkins (2000)'s SWC = 0.5 x the athlete's own
 *   between-day standard deviation, applied to HRV specifically by Plews/Buchheit — the
 *   threshold this file uses for "is today meaningfully different from this person's normal,"
 *   not an invented cutoff.
 * - **A ~60-day baseline window**: the most consistently repeated figure across independent
 *   HRV-guided-training implementations (Plews/Buchheit, Altini's HRV4Training methodology).
 * - **WHOOP's published red/yellow/green cutoffs** (0-33% / 34-66% / 67-100%) are real and
 *   reused here, since they are the one part of WHOOP's scoring that actually is public.
 *
 * **What is FORJD's own design choice, not derived from any published source**: how the four
 * components combine into one number. No company publishes that formula, and no peer-reviewed
 * multi-factor (HRV+RHR+sleep+respiratory) composite with disclosed weights exists to copy. This
 * file uses a simple, transparent, equal-weighted average of four independently-baselined
 * components — deliberately not dressed up as more authoritative than it is. Components stay
 * separately visible in the UI for exactly this reason (ADR-031, and unlike WHOOP's opaque
 * single number, closer to how Oura exposes its own eight named contributors).
 *
 * @see docs/decisions/ADR-031-readiness-score-methodology.md
 */

export type ReadinessComponentKey = 'hrv' | 'resting_heart_rate' | 'sleep_duration' | 'respiratory_rate';

export interface ReadinessDailyReading {
  /** `YYYY-MM-DD`, the local calendar date this reading represents. One reading per day is
   *  assumed -- the caller (the service layer, which has the raw per-observation history)
   *  reduces same-day observations to a single daily value before calling this file. */
  date: string;
  value: number;
}

export type ReadinessZone = 'red' | 'yellow' | 'green';

export type ReadinessComponentLabel = 'low' | 'normal' | 'elevated';

export interface ReadinessComponentResult {
  key: ReadinessComponentKey;
  /** 0-100, or `null` when this component has too little baseline history to score. */
  score: number | null;
  /** `null` until the SWC threshold is crossed either way -- "normal" means "not
   *  meaningfully different from this person's own baseline," not "at some ideal value." */
  label: ReadinessComponentLabel | null;
  /** The smoothed recent value actually used, in the metric's own canonical unit -- always
   *  reported when there is at least one reading in the last 7 days, independent of whether
   *  there was enough history to score against a baseline. */
  recentValue: number | null;
  /** How many distinct days of history fed the baseline (out of the last 60). */
  baselineDayCount: number;
}

export interface ReadinessResult {
  /** 0-100 composite, or `null` when withheld. */
  score: number | null;
  zone: ReadinessZone | null;
  components: readonly ReadinessComponentResult[];
  /** Set whenever `score` is `null`, naming what is still missing. */
  withheldReason: string | null;
}

const BASELINE_WINDOW_DAYS = 60;
const RECENT_WINDOW_DAYS = 7;
/** Hopkins (2000)'s smallest-worthwhile-change multiplier, applied to HRV by Plews/Buchheit. */
const SWC_MULTIPLIER = 0.5;
/** "Roughly a month," per ADR-031 -- distinct daily readings required within the 60-day
 *  baseline window before a component is considered scoreable at all. Sits between WHOOP's
 *  ~30-day full-calibration figure and Oura's ~14-day contributor baseline, on the
 *  conservative side of the academic 60-90 day SD-stabilization window. */
const MIN_BASELINE_DAYS = 30;

/** Higher-is-better components use `ln` (HRV) or the raw value (sleep duration) directly;
 *  lower-is-better components (RHR, respiratory rate) are direction-flipped after the same
 *  z-score computation, not given a different formula. */
const HIGHER_IS_BETTER: Record<ReadinessComponentKey, boolean> = {
  hrv: true,
  sleep_duration: true,
  resting_heart_rate: false,
  respiratory_rate: false,
};

/** Only HRV is log-transformed -- see this file's header docblock for why. */
function transform(key: ReadinessComponentKey, value: number): number {
  return key === 'hrv' ? Math.log(value) : value;
}

function inverseTransform(key: ReadinessComponentKey, value: number): number {
  return key === 'hrv' ? Math.exp(value) : value;
}

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** A baseline SD below this is treated as exactly zero. Floating-point arithmetic on 60
 *  repeated `ln(x)` values does not land on bit-identical numbers, so the naive `sd === 0`
 *  check almost never fires -- dividing by a ~1e-16 "SD" instead of a clean zero turns
 *  rounding noise into a wildly amplified z-score. 1e-9 is far below any physiologically
 *  real day-to-day variance in these metrics (HRV in log-space, or raw bpm/minutes), so it
 *  only catches numerical noise, never a genuinely flat-but-real baseline. */
const ZERO_VARIANCE_EPSILON = 1e-9;

function mean(xs: readonly number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

/** Sample standard deviation (n-1 denominator) -- the baseline is a sample of this person's
 *  own history, not the full population of days they will ever have. */
function sampleStdDev(xs: readonly number[], m: number): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Collapses more than one reading on the same calendar date to their mean, so a caller that
 *  violates the "one reading per day" contract (this file's own docblock) cannot silently
 *  inflate `baselineDayCount` past the real number of distinct days measured -- 15 real days
 *  each duplicated twice must not count as 30 days of baseline. */
function dedupeByDate(readings: readonly ReadinessDailyReading[]): ReadinessDailyReading[] {
  const byDate = new Map<string, number[]>();
  for (const r of readings) {
    const values = byDate.get(r.date) ?? [];
    values.push(r.value);
    byDate.set(r.date, values);
  }
  return Array.from(byDate.entries()).map(([date, values]) => ({ date, value: mean(values) }));
}

function scoreComponent(
  key: ReadinessComponentKey,
  rawReadings: readonly ReadinessDailyReading[],
  asOf: string,
): ReadinessComponentResult {
  const readings = dedupeByDate(rawReadings);

  // `-1` so a window "of N days" spans exactly N calendar dates inclusive of its own end date
  // (e.g. RECENT_WINDOW_DAYS=7 means [asOf-6 .. asOf], not 8 days).
  const recentStart = daysBefore(asOf, RECENT_WINDOW_DAYS - 1);
  // The baseline window does NOT overlap the recent window -- it ends the day before the
  // recent window starts. An overlapping design (recent days counted in their own comparison
  // baseline) dampens exactly the signal this function exists to detect: a real 7-day spike
  // pulls the baseline mean toward itself, understating its own deviation. Non-overlapping
  // "today vs. the period before today" is also the simpler, more standard framing in the
  // HRV-guided-training literature this file is built from.
  const baselineEnd = daysBefore(recentStart, 1);
  const baselineStart = daysBefore(baselineEnd, BASELINE_WINDOW_DAYS - 1);

  const baselineReadings = readings.filter((r) => r.date >= baselineStart && r.date <= baselineEnd);
  const recentReadings = readings.filter((r) => r.date >= recentStart && r.date <= asOf);

  const recentValue =
    recentReadings.length === 0
      ? null
      : inverseTransform(key, mean(recentReadings.map((r) => transform(key, r.value))));

  const baselineDayCount = baselineReadings.length;

  if (baselineDayCount < MIN_BASELINE_DAYS || recentValue === null) {
    return { key, score: null, label: null, recentValue, baselineDayCount };
  }

  const baselineTransformed = baselineReadings.map((r) => transform(key, r.value));
  const baselineMean = mean(baselineTransformed);
  const baselineSd = sampleStdDev(baselineTransformed, baselineMean);

  const recentTransformed = transform(key, recentValue);
  const deviation = recentTransformed - baselineMean;
  // z is in units of the athlete's own baseline SD. A near-zero baseline SD needs care, and
  // conflates two different situations that must NOT be handled the same way:
  //   - Floating-point noise on a baseline that is conceptually flat (60 repeated `ln(x)`
  //     values do not land on bit-identical numbers) -- if the recent value is *also*
  //     unchanged, this is genuinely "no deviation," z = 0.
  //   - A baseline that really has had zero variance (this metric has never moved in 60
  //     days) and recent readings that HAVE moved -- dividing a real, non-zero deviation by
  //     a near-zero SD is not "no deviation," it is an extreme one (formally, infinitely
  //     many baseline SDs away). Collapsing this to z=0 would make an unprecedented change
  //     look neutral. It saturates instead, via a sentinel far past where `score` already
  //     clamps to 0/100 (|z| >= 2), rather than computing a numerically unstable near-Infinity.
  const NEAR_ZERO_BASELINE_SATURATION_Z = 10;
  const z =
    baselineSd >= ZERO_VARIANCE_EPSILON
      ? deviation / baselineSd
      : Math.abs(deviation) < ZERO_VARIANCE_EPSILON
        ? 0
        : Math.sign(deviation) * NEAR_ZERO_BASELINE_SATURATION_Z;
  const directedZ = HIGHER_IS_BETTER[key] ? z : -z;

  // Neutral (z=0) maps to 50; +/-2 baseline SDs saturates the 0-100 range. The SWC threshold
  // (0.5 SD) is used separately below for the qualitative label, not for this mapping.
  const score = clamp(50 + directedZ * 25, 0, 100);
  const label: ReadinessComponentLabel =
    directedZ >= SWC_MULTIPLIER ? 'elevated' : directedZ <= -SWC_MULTIPLIER ? 'low' : 'normal';

  return { key, score, label, recentValue, baselineDayCount };
}

/**
 * Computes the composite readiness score for one day, from up to 60 days of trailing daily
 * readings per component. `asOf` is the local calendar date (`YYYY-MM-DD`) readiness is being
 * computed for -- always the caller's "today," never derived from the readings themselves, so
 * a gap in recent data cannot silently roll the window back a day.
 *
 * The composite requires every one of the four components to itself be scoreable
 * (`MIN_BASELINE_DAYS` of baseline history plus a recent reading) -- ADR-031's "withheld with
 * an explanation until roughly a month of history exists" applies to the composite, not
 * component-by-component; a component with too little history still reports its own
 * `recentValue` (useful for a raw-number display like the stat strip) even while `score`/`label`
 * stay `null` and the composite is withheld.
 */
export function computeReadiness(
  readings: Readonly<Record<ReadinessComponentKey, readonly ReadinessDailyReading[]>>,
  asOf: string,
): ReadinessResult {
  const keys: readonly ReadinessComponentKey[] = ['hrv', 'resting_heart_rate', 'sleep_duration', 'respiratory_rate'];
  const components = keys.map((key) => scoreComponent(key, readings[key], asOf));

  const unscored = components.filter((c) => c.score === null);
  if (unscored.length > 0) {
    const names = unscored.map((c) => c.key).join(', ');
    return {
      score: null,
      zone: null,
      components,
      withheldReason: `Still building your baseline for: ${names}. Needs ${MIN_BASELINE_DAYS} days of history.`,
    };
  }

  const composite = mean(components.map((c) => c.score as number));
  // Rounded first, then zoned -- the zone is computed from the number actually shown to the
  // athlete, not the unrounded intermediate. Zoning the raw composite instead could show a
  // score of "33" in the yellow zone (if the true composite were 33.4, rounding down to 33
  // for display) or vice versa, contradicting the on-screen number.
  const roundedScore = Math.round(composite);
  const zone: ReadinessZone = roundedScore <= 33 ? 'red' : roundedScore <= 66 ? 'yellow' : 'green';

  return { score: roundedScore, zone, components, withheldReason: null };
}
