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

function isFix(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.latitude) &&
    isFiniteNumber(value.longitude) &&
    isNullableNumber(value.altitudeMeters) &&
    isNullableNumber(value.accuracyMeters) &&
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
    (value.status === 'running' || value.status === 'paused') &&
    isFiniteNumber(value.startedAtMs) &&
    isFiniteNumber(value.movedBeforeMs) &&
    isNullableNumber(value.runningSinceMs) &&
    typeof value.nextFixStartsSegment === 'boolean' &&
    Array.isArray(value.fixes) &&
    value.fixes.every(isFix) &&
    Array.isArray(value.heartRate) &&
    value.heartRate.every(isBeat)
  );
}

export function restoreRunSnapshot(payload: unknown): RunState | null {
  if (!isRecord(payload) || !isFiniteNumber(payload.savedAtMs) || !isSavedState(payload.state)) {
    return null;
  }
  const saved = payload.state;
  const savedAtMs = payload.savedAtMs;
  const paused = pauseRun(saved, savedAtMs);
  // Whatever the saved status, the next reading must start a segment.
  return { ...paused, movedBeforeMs: movingMsAt(saved, savedAtMs), nextFixStartsSegment: true };
}
