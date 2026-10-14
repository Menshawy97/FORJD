/**
 * Run calculations — the numbers a GPS run shows and stores: distance, pace, splits, elevation
 * and an estimated energy cost, worked out from a list of position fixes.
 *
 * Domain code: no UI, no location SDK, no database (CLAUDE.md rules 1 and 2). The phone feeds it
 * plain fixes; nothing here knows where they came from. Every formula is written down in
 * `docs/product/live-run-plan.md` and explained to the user in the FAQ, so a change here is a
 * change to both.
 */

/** One position reading during a run. */
export interface RunFix {
  latitude: number;
  longitude: number;
  /** Metres above sea level, or `null` when the phone did not report one. */
  altitudeMeters: number | null;
  /** Horizontal accuracy radius in metres, or `null` when the phone did not report one. */
  accuracyMeters: number | null;
  /** Wall-clock time of the reading, in epoch milliseconds. */
  timestampMs: number;
  /** Time spent moving before this reading, in milliseconds. Paused time is not included. */
  movingMs: number;
  /** True for the first reading after a pause. Nothing measured across it is counted. */
  segmentStart: boolean;
}

/** One full kilometre of a run. */
export interface RunSplit {
  /** 1 for the first kilometre. */
  index: number;
  distanceMeters: number;
  /** Moving time for this kilometre. */
  durationSeconds: number;
  /** Wall-clock span, for matching heart-rate samples to the split. */
  startTimestampMs: number;
  endTimestampMs: number;
}

export interface HeartRateSample {
  timestampMs: number;
  bpm: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

/** A reading less accurate than this is ignored. */
export const MAX_FIX_ACCURACY_METERS = 25;

/**
 * A reading that implies faster than this since the last accepted one is a GPS jump, not running.
 * 12 m/s is 43 km/h: above a sprint, so no honest step is thrown away.
 */
export const MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND = 12;

/**
 * A rise counts towards elevation gain only once it passes this, so altitude noise (a few metres of
 * wobble on a flat road) is not counted as climbing. A product rule, not a published method.
 */
export const ELEVATION_THRESHOLD_METERS = 3;

/** How far back "current speed" looks. */
export const SPEED_WINDOW_MS = 10_000;

export const SPLIT_DISTANCE_METERS = 1000;

/**
 * At or above this speed the ACSM running equation applies; below it, the walking one. 134 m/min
 * is 8.04 km/h (5 mph), the boundary ACSM gives between the two.
 */
export const ACSM_RUNNING_THRESHOLD_M_PER_MIN = 134;

/**
 * After this many readings in a row are thrown away as jumps, the next one starts a fresh segment.
 * Without it a bad first reading (a cold-start GPS fix a kilometre off) would make every real
 * reading after it look like a jump, and the run would record nothing.
 */
export const MAX_CONSECUTIVE_REJECTIONS = 5;

/** Floating-point slack when deciding a kilometre boundary has been reached, in metres. */
const BOUNDARY_EPSILON_METERS = 1e-6;

/** Great-circle distance between two readings, in metres. */
export function haversineMeters(
  a: Pick<RunFix, 'latitude' | 'longitude'>,
  b: Pick<RunFix, 'latitude' | 'longitude'>,
): number {
  const toRadians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRadians;
  const dLon = (b.longitude - a.longitude) * toRadians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRadians) * Math.cos(b.latitude * toRadians) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a new reading belongs in the track, judged against the last one that did.
 *
 * Rejected: a reading with a non-finite number in it, one less accurate than
 * `MAX_FIX_ACCURACY_METERS`, one whose wall-clock time is not later than the previous (or whose
 * moving time goes backwards), and one that implies a jump faster than
 * `MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND`. A reading of unknown accuracy can follow a known one, since
 * speed still checks it, but cannot start the track or a segment: everything after is judged
 * against that reading. The first reading after a pause is judged by accuracy and time only, since
 * the runner may have moved while paused and that gap is never counted.
 */
export function acceptFix(previous: RunFix | null, next: RunFix): boolean {
  if (!isUsable(next)) return false;
  const anchors = previous === null || next.segmentStart;
  // A reading with unknown accuracy can be judged by speed against its predecessor, but must not
  // be the one every later reading is judged against.
  if (anchors && next.accuracyMeters === null) return false;
  if (next.accuracyMeters !== null && next.accuracyMeters > MAX_FIX_ACCURACY_METERS) return false;
  if (previous === null) return true;
  if (next.timestampMs <= previous.timestampMs || next.movingMs < previous.movingMs) return false;
  if (next.segmentStart) return true;
  const seconds = (next.movingMs - previous.movingMs) / 1000;
  if (seconds <= 0) return false;
  return haversineMeters(previous, next) / seconds <= MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND;
}

/** Every number the maths reads is finite: one NaN would otherwise poison the whole track. */
function isUsable(fix: RunFix): boolean {
  return (
    Number.isFinite(fix.latitude) &&
    Number.isFinite(fix.longitude) &&
    Number.isFinite(fix.timestampMs) &&
    Number.isFinite(fix.movingMs) &&
    (fix.accuracyMeters === null || Number.isFinite(fix.accuracyMeters))
  );
}

/**
 * The accepted readings, in order. Each is judged against the last one accepted. After
 * `MAX_CONSECUTIVE_REJECTIONS` jumps in a row the next usable reading starts a new segment, so the
 * track recovers from a bad anchor instead of staying stuck on it.
 */
export function buildTrack(fixes: readonly RunFix[]): RunFix[] {
  const track: RunFix[] = [];
  let rejections = 0;
  for (const fix of fixes) {
    const last = track[track.length - 1] ?? null;
    if (acceptFix(last, fix)) {
      track.push(fix);
      rejections = 0;
      continue;
    }
    rejections += 1;
    const reanchored = { ...fix, segmentStart: true };
    if (rejections >= MAX_CONSECUTIVE_REJECTIONS && acceptFix(last, reanchored)) {
      track.push(reanchored);
      rejections = 0;
    }
  }
  return track;
}

interface Step {
  from: RunFix;
  to: RunFix;
  meters: number;
}

/** The steps that count: consecutive readings, except across a pause. */
function* countedSteps(track: readonly RunFix[]): Generator<Step> {
  for (let i = 1; i < track.length; i++) {
    const from = track[i - 1];
    const to = track[i];
    if (from === undefined || to === undefined || to.segmentStart) continue;
    yield { from, to, meters: haversineMeters(from, to) };
  }
}

/** Distance along an accepted track, in metres. */
export function trackDistanceMeters(track: readonly RunFix[]): number {
  let total = 0;
  for (const step of countedSteps(track)) total += step.meters;
  return total;
}

/**
 * The time for each full kilometre, found by interpolating where the boundary falls inside the
 * step that crosses it. A long step can cross several. A partial last kilometre is not a split.
 */
/**
 * `splitMeters` is the split length: a kilometre by default (what is saved and uploaded), or a mile for the
 * runs-in-miles display (docs/product/run-miles-plan.md).
 */
export function splitsFromTrack(track: readonly RunFix[], splitMeters: number = SPLIT_DISTANCE_METERS): RunSplit[] {
  const splits: RunSplit[] = [];
  const first = track[0];
  if (first === undefined) return splits;

  let cumulative = 0;
  let nextBoundary = splitMeters;
  let splitStartMoving = first.movingMs;
  let splitStartWall = first.timestampMs;

  for (const { from, to, meters } of countedSteps(track)) {
    const startCumulative = cumulative;
    cumulative += meters;
    while (meters > 0 && nextBoundary <= cumulative + BOUNDARY_EPSILON_METERS) {
      const fraction = Math.min(1, Math.max(0, (nextBoundary - startCumulative) / meters));
      const movingAt = from.movingMs + fraction * (to.movingMs - from.movingMs);
      const wallAt = from.timestampMs + fraction * (to.timestampMs - from.timestampMs);
      splits.push({
        index: splits.length + 1,
        distanceMeters: splitMeters,
        durationSeconds: (movingAt - splitStartMoving) / 1000,
        startTimestampMs: splitStartWall,
        endTimestampMs: wallAt,
      });
      splitStartMoving = movingAt;
      splitStartWall = wallAt;
      nextBoundary += splitMeters;
    }
  }
  return splits;
}

/** Seconds per kilometre, or `null` before there is any distance or time to divide. */
export function averagePaceSecondsPerKm(distanceMeters: number, movingSeconds: number): number | null {
  if (distanceMeters <= 0 || movingSeconds <= 0) return null;
  return movingSeconds / (distanceMeters / 1000);
}

/**
 * Speed over the last `SPEED_WINDOW_MS`, in metres per second, or `null` with fewer than two
 * readings in the window. Steps across a pause are left out of both the distance and the time.
 */
export function currentSpeedMetersPerSecond(track: readonly RunFix[]): number | null {
  const last = track[track.length - 1];
  if (track.length < 2 || last === undefined) return null;
  const cutoff = last.movingMs - SPEED_WINDOW_MS;
  let meters = 0;
  let seconds = 0;
  for (let i = track.length - 1; i >= 1; i--) {
    const from = track[i - 1];
    const to = track[i];
    if (from === undefined || to === undefined || from.movingMs < cutoff) break;
    if (to.segmentStart) continue;
    meters += haversineMeters(from, to);
    seconds += (to.movingMs - from.movingMs) / 1000;
  }
  return seconds > 0 ? meters / seconds : null;
}

function altitudes(track: readonly RunFix[]): number[] {
  return track.flatMap((fix) =>
    fix.altitudeMeters !== null && Number.isFinite(fix.altitudeMeters) ? [fix.altitudeMeters] : [],
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Total climbing in metres, or `null` when no reading had an altitude. It counts a rise only once it
 * passes `ELEVATION_THRESHOLD_METERS` from the last reference, and moves the reference down on a
 * real descent, so wobble is ignored and a hill is not counted twice.
 */
export function elevationGainMeters(track: readonly RunFix[]): number | null {
  const [first, ...rest] = altitudes(track);
  if (first === undefined) return null;
  let reference = first;
  let gain = 0;
  for (const altitude of rest) {
    if (altitude - reference >= ELEVATION_THRESHOLD_METERS) {
      gain += altitude - reference;
      reference = altitude;
    } else if (reference - altitude >= ELEVATION_THRESHOLD_METERS) {
      reference = altitude;
    }
  }
  return gain;
}

/** How many readings at each end are combined, by median, for the net climb. */
const NET_CLIMB_EDGE_READINGS = 3;

/**
 * End altitude minus start altitude, never below zero, or `null` without altitudes. GPS altitude
 * on the very first readings is notoriously noisy, so with enough readings each end is the median
 * of its first (or last) three; a short track uses the raw ends.
 */
export function netClimbMeters(track: readonly RunFix[]): number | null {
  const values = altitudes(track);
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined) return null;
  if (values.length < NET_CLIMB_EDGE_READINGS * 2) return Math.max(0, last - first);
  const start = median(values.slice(0, NET_CLIMB_EDGE_READINGS));
  const end = median(values.slice(-NET_CLIMB_EDGE_READINGS));
  return Math.max(0, end - start);
}

export interface RunCalorieInput {
  distanceMeters: number;
  movingSeconds: number;
  /** From `netClimbMeters`; `null` is treated as flat. */
  netClimbMeters: number | null;
  /** The person's latest recorded weight; `null` means no estimate is possible. */
  weightKg: number | null;
}

/**
 * Estimated energy cost of a run in kilocalories, or `null` when it cannot be worked out.
 *
 * ACSM's metabolic equations for running and walking, from *ACSM's Guidelines for Exercise Testing
 * and Prescription*, 11th ed. (Wolters Kluwer, 2021). With speed `v` in metres per minute and
 * `grade` as a fraction: running (at or above 134 m/min) `VO2 = 0.2v + 0.9v·grade + 3.5`, walking
 * `VO2 = 0.1v + 1.8v·grade + 3.5`, both in mL·kg⁻¹·min⁻¹. Energy is `VO2 · kg / 1000 · 5` kcal per
 * minute, about 5 kcal per litre of oxygen. The equations describe a constant incline, so the grade
 * is the net climb over the distance, not the total gain, which would overstate a loop.
 *
 * An estimate for an average person, not a measurement: a watch that measures heart rate will
 * usually be closer, and the app uses the watch's figure when it has one.
 */
export function estimateRunCaloriesKcal(input: RunCalorieInput): number | null {
  const { distanceMeters, movingSeconds, weightKg } = input;
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isFinite(movingSeconds) || movingSeconds <= 0) return null;
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;

  const metersPerMinute = distanceMeters / (movingSeconds / 60);
  const climb = input.netClimbMeters !== null && Number.isFinite(input.netClimbMeters) ? input.netClimbMeters : 0;
  const grade = Math.max(0, climb) / distanceMeters;
  const vo2 =
    metersPerMinute >= ACSM_RUNNING_THRESHOLD_M_PER_MIN
      ? 0.2 * metersPerMinute + 0.9 * metersPerMinute * grade + 3.5
      : 0.1 * metersPerMinute + 1.8 * metersPerMinute * grade + 3.5;
  const kcalPerMinute = ((vo2 * weightKg) / 1000) * 5;
  return Math.round(kcalPerMinute * (movingSeconds / 60));
}

/** Mean heart rate of the samples in `[fromMs, toMs]`, to a whole beat, or `null` with none. */
export function averageHeartRate(
  samples: readonly HeartRateSample[],
  fromMs: number,
  toMs: number,
): number | null {
  const inWindow = samples.filter((sample) => sample.timestampMs >= fromMs && sample.timestampMs <= toMs);
  if (inWindow.length === 0) return null;
  return Math.round(inWindow.reduce((sum, sample) => sum + sample.bpm, 0) / inWindow.length);
}

/** Below this average heart rate Keytel's equation was not fitted (exercise heart rates), so it is not used. */
export const KEYTEL_MIN_HEART_RATE_BPM = 90;

const KJ_PER_KCAL = 4.184;
const MINUTES_PER_DAY = 1440;

export interface RunActiveCalorieInput extends RunCalorieInput {
  /** The latest scan's basal metabolic rate; `null` uses 1 MET for resting energy. */
  bmrKcal: number | null;
  /** Mean heart rate over the run, only with health-data consent; `null` uses the pace equation. */
  avgHeartRateBpm: number | null;
  ageYears: number | null;
  sex: 'male' | 'female' | 'prefer_not_to_say' | null;
}

/**
 * Gross energy from heart rate, kcal per minute: Keytel et al., *J Sports Sci* 2005;23(3):289–297,
 * the equations without VO2max, in kJ/min. Men `−55.0969 + 0.6309·HR + 0.1988·kg + 0.2017·age`,
 * women `−20.4022 + 0.4472·HR − 0.1263·kg + 0.074·age`. Null when sex is not given.
 */
function keytelGrossKcalPerMinute(heartRate: number, weightKg: number, ageYears: number, sex: RunActiveCalorieInput['sex']) {
  if (sex === 'male') return (-55.0969 + 0.6309 * heartRate + 0.1988 * weightKg + 0.2017 * ageYears) / KJ_PER_KCAL;
  if (sex === 'female') return (-20.4022 + 0.4472 * heartRate - 0.1263 * weightKg + 0.074 * ageYears) / KJ_PER_KCAL;
  return null;
}

/**
 * Estimated *active* energy of a run in kilocalories, or `null` when it cannot be worked out
 * (docs/product/scan-height-age-plan.md §4.4). A watch reports active energy, so this does too:
 * gross energy minus resting energy over the moving time, never below zero.
 *
 * - Gross: Keytel's heart-rate equation when the mean heart rate (at least 90 bpm), age and sex are
 *   known, since it is more personal than pace; otherwise the ACSM pace equation
 *   (`estimateRunCaloriesKcal`).
 * - Resting: the latest scan's BMR spread over the day, else 1 MET (3.5 mL·kg⁻¹·min⁻¹, 0.0175 kcal
 *   per kg per minute at 5 kcal per litre of oxygen).
 */
export function estimateRunActiveCaloriesKcal(input: RunActiveCalorieInput): number | null {
  const { weightKg, movingSeconds, avgHeartRateBpm, ageYears } = input;
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isFinite(movingSeconds) || movingSeconds <= 0) return null;
  const minutes = movingSeconds / 60;

  const keytel =
    avgHeartRateBpm !== null && avgHeartRateBpm >= KEYTEL_MIN_HEART_RATE_BPM && ageYears !== null
      ? keytelGrossKcalPerMinute(avgHeartRateBpm, weightKg, ageYears, input.sex)
      : null;
  let grossPerMinute = keytel;
  if (grossPerMinute === null) {
    const gross = estimateRunCaloriesKcal(input);
    if (gross === null) return null;
    grossPerMinute = gross / minutes;
  }

  const restingPerMinute =
    input.bmrKcal !== null && Number.isFinite(input.bmrKcal) && input.bmrKcal > 0
      ? input.bmrKcal / MINUTES_PER_DAY
      : (3.5 * weightKg * 5) / 1000;
  return Math.max(0, Math.round((grossPerMinute - restingPerMinute) * minutes));
}
