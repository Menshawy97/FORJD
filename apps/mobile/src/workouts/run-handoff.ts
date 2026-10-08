/**
 * Hands a finished run to the run-complete screen (ADR-050), the counterpart of
 * `live-handoff.ts`'s `CompletedSummary` for the strength runner and for the same reason: expo-router
 * cannot pass a structured value between screens, and the summary is a read-only report of *computed*
 * figures, so nothing there can write back into a run already queued for upload.
 */
export interface CompletedRun {
  distanceMeters: number;
  movingSeconds: number;
  averagePaceSecondsPerKm: number | null;
  /** Null unless a watch fed heart rate and health data was allowed. */
  avgHeartRateBpm: number | null;
  caloriesKcal: number | null;
  caloriesSource: 'watch' | 'estimate' | null;
  elevationGainMeters: number | null;
  splits: Array<{ index: number; durationSeconds: number; avgHeartRateBpm: number | null }>;
  /** The accepted readings, for drawing the route. It stays on the phone. */
  route: Array<{ latitude: number; longitude: number }>;
  /** Metrics Health Connect refused at Finish (access turned off), so the summary can say so. */
  healthBlocked?: readonly RunMetric[];
}

/** The two watch readings a run asks Health Connect for; also what it can be refused. */
export type RunMetric = 'heart_rate' | 'active_energy';

let completed: CompletedRun | null = null;

export function setCompletedRun(run: CompletedRun): void {
  completed = run;
}

export function getCompletedRun(): CompletedRun | null {
  return completed;
}

/** Cleared on the way out of the summary, so a finished run is never shown a second time. */
export function clearCompletedRun(): void {
  completed = null;
}
