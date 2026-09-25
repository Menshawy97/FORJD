import type { WorkoutSessionUploadRequest } from '@forjd/contracts';
import {
  averageHeartRate,
  averagePaceSecondsPerKm,
  buildTrack,
  currentSpeedMetersPerSecond,
  elevationGainMeters,
  estimateRunActiveCaloriesKcal,
  netClimbMeters,
  splitsFromTrack,
  trackDistanceMeters,
  type HeartRateSample,
  type RunFix,
  type RunSplit,
} from '@forjd/domain';

import { COARSE_DECIMALS, type PreciseFix } from '@/integrations/location/location-provider';

/**
 * The live run engine (ADR-049, ADR-050): a pure, immutable state machine over a run's GPS
 * readings, the counterpart of `live-session.ts` for the strength runner.
 *
 * It owns the bookkeeping the screen and the recovery store share: when moving time runs and
 * stops, which readings count, and how a finished run becomes the upload the sync queue sends. The
 * arithmetic itself (distance, splits, pace, elevation, calories) is `@forjd/domain`'s
 * `run-calculations`, so a formula has one home. Nothing here touches location, the network or a
 * database: the screen feeds it readings and the store persists what it says.
 *
 * Two clocks, as in the domain: wall time (`timestampMs`) and moving time (`movingMs`), which stops
 * while paused. A reading taken after a resume starts a new segment, so the runner walking across
 * town while paused is never counted as distance.
 */
export type RunStatus = 'running' | 'paused' | 'finished';

export interface RunState {
  /** Client-generated at start; also the upload's idempotency key, like a strength session's. */
  id: string;
  status: RunStatus;
  startedAtMs: number;
  endedAtMs: number | null;
  /** Moving time banked before the current running stretch, in milliseconds. */
  movedBeforeMs: number;
  /** When the current running stretch began; null while paused or finished. */
  runningSinceMs: number | null;
  /** True until the next reading, which then starts a segment (the first, and each after a resume). */
  nextFixStartsSegment: boolean;
  /** Every reading received while running. `buildTrack` decides which of them count. */
  fixes: readonly RunFix[];
  /** Watch heart-rate samples, oldest first. Empty unless a watch is feeding Health Connect. */
  heartRate: readonly HeartRateSample[];
}

/**
 * The exercise a run is logged against is the curated "Outdoor Run" (ADR-050), whose id the server
 * assigns and the phone cannot know while offline. A queued run carries this placeholder and the
 * sync step swaps in the real id from the exercise catalogue when it uploads (`run-exercise.ts`).
 */
export const RUN_EXERCISE_PLACEHOLDER_ID = '00000000-0000-4000-8000-0000000000a1';

/** The catalogue slug of that exercise, `apps/api/src/programs/seed/curated-exercises.ts`. */
export const RUN_EXERCISE_SLUG = 'outdoor-run';

/** Less than this and a "run" was a phone in a pocket: it is offered for discarding, not saving. */
export const MIN_SAVEABLE_RUN_METERS = 50;

/** The upload contract's own ceilings (`workoutSessionUploadRequestSchema`), so an extreme run still saves. */
const MAX_DISTANCE_METERS = 200_000;
const MAX_MOVING_SECONDS = 86_400;
const MAX_SPLITS = 200;
const MAX_ELEVATION_GAIN_METERS = 10_000;
const MAX_CALORIES_KCAL = 20_000;
const MIN_HEART_RATE_BPM = 30;
const MAX_HEART_RATE_BPM = 250;

export function startRun(id: string, nowMs: number): RunState {
  return {
    id,
    status: 'running',
    startedAtMs: nowMs,
    endedAtMs: null,
    movedBeforeMs: 0,
    runningSinceMs: nowMs,
    nextFixStartsSegment: true,
    fixes: [],
    heartRate: [],
  };
}

/** Moving time at `nowMs`, in milliseconds. Frozen while paused and once finished. */
export function movingMsAt(state: RunState, nowMs: number): number {
  if (state.runningSinceMs === null) {
    return state.movedBeforeMs;
  }
  return state.movedBeforeMs + Math.max(0, nowMs - state.runningSinceMs);
}

export function pauseRun(state: RunState, nowMs: number): RunState {
  if (state.status !== 'running') {
    return state;
  }
  return { ...state, status: 'paused', movedBeforeMs: movingMsAt(state, nowMs), runningSinceMs: null };
}

export function resumeRun(state: RunState, nowMs: number): RunState {
  if (state.status !== 'paused') {
    return state;
  }
  return { ...state, status: 'running', runningSinceMs: nowMs, nextFixStartsSegment: true };
}

export function finishRun(state: RunState, nowMs: number): RunState {
  if (state.status === 'finished') {
    return state;
  }
  return {
    ...state,
    status: 'finished',
    endedAtMs: nowMs,
    movedBeforeMs: movingMsAt(state, nowMs),
    runningSinceMs: null,
  };
}

/** Records a reading, stamped with the moving time it was taken at. Ignored unless running. */
export function addFix(state: RunState, fix: PreciseFix): RunState {
  if (state.status !== 'running') {
    return state;
  }
  const recorded: RunFix = {
    latitude: fix.latitude,
    longitude: fix.longitude,
    altitudeMeters: fix.altitudeMeters,
    accuracyMeters: fix.accuracyMeters,
    timestampMs: fix.timestampMs,
    movingMs: movingMsAt(state, fix.timestampMs),
    segmentStart: state.nextFixStartsSegment,
  };
  return { ...state, fixes: [...state.fixes, recorded], nextFixStartsSegment: false };
}

const isPlausibleBeat = (sample: HeartRateSample): boolean =>
  Number.isFinite(sample.timestampMs) &&
  Number.isFinite(sample.bpm) &&
  sample.bpm >= MIN_HEART_RATE_BPM &&
  sample.bpm <= MAX_HEART_RATE_BPM;

/** Adds watch samples: implausible ones are dropped, repeats ignored, and the list stays in time order. */
export function addHeartRate(state: RunState, samples: readonly HeartRateSample[]): RunState {
  const seen = new Set(state.heartRate.map((s) => `${s.timestampMs}:${s.bpm}`));
  const fresh = samples.filter((s) => isPlausibleBeat(s) && !seen.has(`${s.timestampMs}:${s.bpm}`));
  if (fresh.length === 0) {
    return state;
  }
  const merged = [...state.heartRate, ...fresh].sort((a, b) => a.timestampMs - b.timestampMs);
  return { ...state, heartRate: merged };
}

export interface RunStats {
  distanceMeters: number;
  movingSeconds: number;
  averagePaceSecondsPerKm: number | null;
  currentSpeedMetersPerSecond: number | null;
  splits: RunSplit[];
  elevationGainMeters: number | null;
  netClimbMeters: number | null;
  /** The accepted readings, oldest first, for drawing the route. */
  route: Array<{ latitude: number; longitude: number }>;
}

/** What the screen shows and the upload carries, worked out from the readings so far. */
export function runStats(state: RunState, nowMs: number): RunStats {
  const track = buildTrack(state.fixes);
  const distanceMeters = trackDistanceMeters(track);
  const movingSeconds = Math.round(movingMsAt(state, nowMs) / 1000);
  return {
    distanceMeters,
    movingSeconds,
    averagePaceSecondsPerKm: averagePaceSecondsPerKm(distanceMeters, movingSeconds),
    currentSpeedMetersPerSecond: currentSpeedMetersPerSecond(track),
    splits: splitsFromTrack(track),
    elevationGainMeters: elevationGainMeters(track),
    netClimbMeters: netClimbMeters(track),
    route: track.map(({ latitude, longitude }) => ({ latitude, longitude })),
  };
}

export function isRunWorthSaving(stats: RunStats): boolean {
  return stats.distanceMeters >= MIN_SAVEABLE_RUN_METERS;
}

export interface RunUploadOptions {
  /** The latest recorded weight, for the calorie estimate; null means no estimate. */
  weightKg: number | null;
  /** The leaderboard consent (ADR-048): whether to send the rounded start position. */
  allowStartLocation: boolean;
  /** The health-data consent (ADR-043): whether heart rate and calories may go to the server. */
  healthDataAllowed: boolean;
  /** Calories the watch reported for the run, if any. Preferred over the estimate. */
  watchCaloriesKcal: number | null;
  /** The latest scan's BMR, for resting energy (scan-height-age-plan.md §4.4); absent uses 1 MET. */
  bmrKcal?: number | null;
  /** Age on the run's date and sex, for Keytel's heart-rate equation; absent uses pace alone. */
  ageYears?: number | null;
  sex?: 'male' | 'female' | 'prefer_not_to_say' | null;
}

const clampInt = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

const roundCoarse = (value: number): number => {
  const factor = 10 ** COARSE_DECIMALS;
  return Math.round(value * factor) / factor;
};

/**
 * The upload for a finished run (ADR-050): an ordinary running session with one completed
 * distance set, plus the `run` summary. **The route is never in it**, and the only coordinate is the
 * first reading rounded to about 110 m, and only for someone who allowed location for leaderboards,
 * exactly as for any workout (ADR-048).
 *
 * Heart rate and the watch's calories are only included when health data is allowed. **An estimated
 * calorie figure is sent regardless of consent**, because it is the app's own arithmetic from pace
 * and weight, not a health reading (ADR-050); the server applies the same consent rule to it anyway,
 * for simplicity, so a device without consent still gets its estimate stripped before storage. Every
 * numeric field is clamped to the contract's limits: a run that overshoots one is saved, not refused.
 */
export function toRunUploadRequest(state: RunState, options: RunUploadOptions): WorkoutSessionUploadRequest {
  if (state.status !== 'finished' || state.endedAtMs === null) {
    // Callers finish the run first; there is no sensible "upload of a run still in progress".
    throw new Error('toRunUploadRequest: the run must be finished before it can be uploaded');
  }
  const endedAtMs = state.endedAtMs;
  const stats = runStats(state, endedAtMs);
  const movingSeconds = clampInt(stats.movingSeconds, 0, MAX_MOVING_SECONDS);
  const distanceMeters = Math.min(MAX_DISTANCE_METERS, Math.round(stats.distanceMeters * 100) / 100);

  const heartRate = options.healthDataAllowed ? state.heartRate : [];
  const avgHeartRate = averageHeartRate(heartRate, state.startedAtMs, endedAtMs);
  const splits = stats.splits.slice(0, MAX_SPLITS).map((split) => ({
    index: split.index,
    distanceMeters: split.distanceMeters,
    durationSeconds: clampInt(split.durationSeconds, 0, MAX_MOVING_SECONDS),
    avgHeartRateBpm: averageHeartRate(heartRate, split.startTimestampMs, split.endTimestampMs),
  }));

  const watchCalories =
    options.healthDataAllowed && options.watchCaloriesKcal !== null && options.watchCaloriesKcal >= 0
      ? Math.round(options.watchCaloriesKcal)
      : null;
  // Active energy, like the watch's figure; from heart rate only when health data is allowed,
  // because `heartRate` is empty otherwise (scan-height-age-plan.md §4.4).
  const estimated = estimateRunActiveCaloriesKcal({
    distanceMeters: stats.distanceMeters,
    movingSeconds: stats.movingSeconds,
    netClimbMeters: stats.netClimbMeters,
    weightKg: options.weightKg,
    bmrKcal: options.bmrKcal ?? null,
    avgHeartRateBpm: avgHeartRate,
    ageYears: options.ageYears ?? null,
    sex: options.sex ?? null,
  });
  const clampedEstimate = estimated === null ? null : Math.min(MAX_CALORIES_KCAL, estimated);
  const calories = watchCalories ?? clampedEstimate;
  const caloriesSource = watchCalories !== null ? 'watch' : clampedEstimate !== null ? 'estimate' : null;

  const first = buildTrack(state.fixes)[0];
  const startLocation =
    options.allowStartLocation && first
      ? { latitude: roundCoarse(first.latitude), longitude: roundCoarse(first.longitude) }
      : null;

  return {
    id: state.id,
    name: 'Outdoor Run',
    activity: 'running',
    status: 'completed',
    startedAt: new Date(state.startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationSeconds: movingSeconds,
    isLiveTracked: true,
    startLocation,
    exercises: [
      {
        exerciseId: RUN_EXERCISE_PLACEHOLDER_ID,
        sets: [{ type: 'working', isCompleted: true, distanceMeters, durationSeconds: movingSeconds }],
      },
    ],
    run: {
      distanceMeters,
      movingSeconds,
      elevationGainMeters:
        stats.elevationGainMeters === null
          ? null
          : Math.min(MAX_ELEVATION_GAIN_METERS, Math.round(stats.elevationGainMeters * 10) / 10),
      avgHeartRateBpm: avgHeartRate,
      caloriesKcal: calories,
      caloriesSource,
      splits,
    },
  };
}
