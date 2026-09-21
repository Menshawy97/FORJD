import type { WorkoutSessionUploadRequest } from '@forjd/contracts';
import { averagePaceSecondsPerKm } from '@forjd/domain';

import type { CompletedRun } from '@/workouts/run-handoff';

/**
 * The run-complete screen's figures, read from the same upload request the sync queue sends
 * (ADR-050), so what is shown and what is stored cannot disagree: distances are already clamped,
 * heart rate is already gone if health data was not allowed, and calories already prefer the
 * watch's value over the estimate.
 *
 * The route is passed in, not read from the request: **the upload carries no route** (ADR-049 #4).
 */
export function toRunSummary(
  request: WorkoutSessionUploadRequest,
  route: CompletedRun['route'],
): CompletedRun {
  const run = request.run;
  if (!run) {
    throw new Error('toRunSummary: the upload has no run summary');
  }
  return {
    distanceMeters: run.distanceMeters,
    movingSeconds: run.movingSeconds,
    averagePaceSecondsPerKm: averagePaceSecondsPerKm(run.distanceMeters, run.movingSeconds),
    avgHeartRateBpm: run.avgHeartRateBpm ?? null,
    caloriesKcal: run.caloriesKcal ?? null,
    caloriesSource: run.caloriesSource ?? null,
    elevationGainMeters: run.elevationGainMeters ?? null,
    splits: run.splits.map((split) => ({
      index: split.index,
      durationSeconds: split.durationSeconds,
      avgHeartRateBpm: split.avgHeartRateBpm ?? null,
    })),
    route,
  };
}
