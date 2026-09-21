import { movingMsAt, pauseRun, type RunState } from '@/workouts/live-run';

/**
 * Crash recovery for a run in progress (ADR-049 #2). The whole `RunState` is saved, with the moment
 * it was saved, into the `run_snapshot` row, and read back when the run screen reopens.
 *
 * **A restored run is always paused at the save time.** While the app was dead nothing was
 * measured, so that time must not count as running, and the person may be anywhere: the first
 * reading after they resume starts a new segment (`resumeRun`), so the walk between is never
 * distance. A run that was already paused stays paused with its banked time. A finished run is
 * never offered back: its snapshot is cleared when it is queued.
 *
 * The payload comes off disk, so it is checked rather than trusted; anything malformed is `null`
 * and the run screen starts fresh instead of crashing on a bad row.
 */
export interface RunSnapshot {
  savedAtMs: number;
  state: RunState;
}

export function toRunSnapshot(state: RunState, savedAtMs: number): Record<string, unknown> {
  return { savedAtMs, state };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isNullableNumber = (value: unknown): boolean => value === null || isFiniteNumber(value);

/** A snapshot older than this is a forgotten run, not one to resume: it is dropped, not offered. */
export const SNAPSHOT_MAX_AGE_MS = 24 * 3_600_000;
/** Far beyond any real run (one reading a second for a day is 86k), so a corrupt row cannot freeze the screen. */
const MAX_SAVED_READINGS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inRange = (value: unknown, limit: number): boolean =>
  isFiniteNumber(value) && Math.abs(value) <= limit;

function isFix(value: unknown): boolean {
  return (
    isRecord(value) &&
    inRange(value.latitude, 90) &&
    inRange(value.longitude, 180) &&
    isNullableNumber(value.altitudeMeters) &&
    (value.accuracyMeters === null || (isFiniteNumber(value.accuracyMeters) && value.accuracyMeters >= 0)) &&
    isFiniteNumber(value.timestampMs) &&
    isFiniteNumber(value.movingMs) &&
    typeof value.segmentStart === 'boolean'
  );
}

function isBeat(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.timestampMs) && isFiniteNumber(value.bpm);
}

function isSavedState(value: unknown): value is RunState {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID.test(value.id) &&
    (value.status === 'running' || value.status === 'paused') &&
    isFiniteNumber(value.startedAtMs) &&
    isFiniteNumber(value.movedBeforeMs) &&
    value.movedBeforeMs >= 0 &&
    isNullableNumber(value.runningSinceMs) &&
    typeof value.nextFixStartsSegment === 'boolean' &&
    Array.isArray(value.fixes) &&
    value.fixes.length <= MAX_SAVED_READINGS &&
    value.fixes.every(isFix) &&
    Array.isArray(value.heartRate) &&
    value.heartRate.length <= MAX_SAVED_READINGS &&
    value.heartRate.every(isBeat)
  );
}

/**
 * `nowMs`, when given, also expires a snapshot older than a day. It is optional so the pure checks
 * stay testable without a clock; the run screen always passes it.
 */
export function restoreRunSnapshot(payload: unknown, nowMs?: number): RunState | null {
  if (!isRecord(payload) || !isFiniteNumber(payload.savedAtMs) || !isSavedState(payload.state)) {
    return null;
  }
  const saved = payload.state;
  const savedAtMs = payload.savedAtMs;
  if (savedAtMs < saved.startedAtMs) return null;
  if (nowMs !== undefined && nowMs - savedAtMs > SNAPSHOT_MAX_AGE_MS) return null;
  const paused = pauseRun(saved, savedAtMs);
  // Whatever the saved status, the next reading must start a segment.
  return { ...paused, movedBeforeMs: movingMsAt(saved, savedAtMs), nextFixStartsSegment: true };
}
