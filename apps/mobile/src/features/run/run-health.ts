import type { HealthProvider, HeartRateSample, SyncedObservation } from '@forjd/domain';

/**
 * A run's watch heart rate and calories, read through `HealthProvider` (CLAUDE.md rules 3 and 17:
 * nothing in this file knows which provider it is talking to). R8, ADR-050 #3.
 *
 * **Health data.** Everything here is only used when the person's health-data consent is on (the
 * caller checks), and it stays on the phone until the run is uploaded, where the server applies the
 * same consent rule again. Nothing is sent to any third party (rule 15).
 *
 * Watches often sync in batches, so a live read can lag the run by minutes; the live screen shows
 * what has arrived and the final read at Finish takes whatever is there by then. A run that gets
 * none of it is simply a run without heart rate: it is never held up or lost for a watch.
 */
export const HEART_RATE_POLL_MS = 30_000;
/** Longest the final read may hold Finish. */
export const FINAL_READ_TIMEOUT_MS = 3000;

const MAX_PLAUSIBLE_RUN_KCAL = 20_000;

import type { RunMetric } from '@/workouts/run-handoff';

export type { RunMetric };

export interface RunHealthReader {
  readHeartRate(sinceMs: number): Promise<HeartRateSample[]>;
  /** Counts the calories of the app that gave the heart rate, so read heart rate first. */
  readActiveEnergyKcal(startMs: number, endMs: number): Promise<number | null>;
  /**
   * The metrics whose last read Health Connect refused (access turned off after it was granted).
   * Different from a read that worked and found nothing: that is a watch that has not synced yet.
   */
  blockedMetrics(): readonly RunMetric[];
}

/** Heart-rate readings as run samples, stamped at their start. Other metrics are ignored. */
export function toHeartRateSamples(observations: readonly SyncedObservation[]): HeartRateSample[] {
  return observations
    .filter((o) => o.metricType === 'heart_rate')
    .map((o) => ({ timestampMs: o.startTime.getTime(), bpm: o.value }));
}

/** The app that wrote the most heart-rate readings, or `null` when none named an app. */
export function heartRateOrigin(observations: readonly SyncedObservation[]): string | null {
  const counts = new Map<string, number>();
  for (const o of observations) {
    if (o.metricType !== 'heart_rate' || !o.dataOrigin) continue;
    counts.set(o.dataOrigin, (counts.get(o.dataOrigin) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * The watch's active energy for the run: the records that start inside it, in kilocalories. `null`
 * when it reported none, so the run falls back to the estimate rather than showing a zero.
 *
 * Several apps can write calories for the same minutes (a watch app and a phone app), and adding them
 * counts the effort twice. Only one app's records are summed (rule 10: the others stay in Health
 * Connect untouched): `preferredOrigin` (the app that gave the heart rate) when it wrote any, otherwise
 * the app with the largest total. Records naming no app count as one app.
 */
export function sumActiveEnergyKcal(
  observations: readonly SyncedObservation[],
  startMs: number,
  endMs: number,
  preferredOrigin: string | null = null,
): number | null {
  const inRun = observations.filter(
    (o) =>
      o.metricType === 'active_energy' &&
      o.unit === 'kcal' &&
      Number.isFinite(o.value) &&
      o.value >= 0 &&
      o.startTime.getTime() >= startMs &&
      o.startTime.getTime() <= endMs,
  );
  if (inRun.length === 0) return null;

  const totals = new Map<string | null, number>();
  for (const o of inRun) {
    const origin = o.dataOrigin ?? null;
    totals.set(origin, (totals.get(origin) ?? 0) + o.value);
  }
  const chosen =
    preferredOrigin !== null && totals.has(preferredOrigin)
      ? preferredOrigin
      : [...totals.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  return Math.min(MAX_PLAUSIBLE_RUN_KCAL, Math.round(totals.get(chosen) ?? 0));
}

export interface RunHealthAccess {
  /** Whether Health Connect was already asked on this phone; if so it is not asked again. */
  alreadyAsked: boolean;
  markAsked: () => Promise<void>;
}

const RUN_METRICS = ['heart_rate', 'active_energy'] as const satisfies readonly RunMetric[];

/**
 * Connects, asks once for heart rate and active energy when it has never asked, and returns a reader
 * for whichever of the two the person granted, or `null` when there is nothing to read (unavailable,
 * or both refused). Never throws.
 *
 * Each metric stands on its own (8.5 S10, L5-1): refusing heart rate alone used to discard granted
 * calories too. A metric not granted is simply never read. On a later run nothing is asked, so
 * nothing is known about the grant and both are read: an ungranted one returns nothing.
 */
export async function prepareRunHealth(
  provider: HealthProvider,
  access: RunHealthAccess,
): Promise<RunHealthReader | null> {
  let readable: readonly RunMetric[] = RUN_METRICS;
  try {
    await provider.connect();
    if (!access.alreadyAsked) {
      // Marked first: "asked once, ever" must hold even if the dialog fails or the app is killed in it.
      await access.markAsked();
      const result = await provider.requestPermissions(RUN_METRICS);
      readable = RUN_METRICS.filter((metric) => result.granted.includes(metric));
      if (readable.length === 0) return null;
    }
  } catch {
    return null;
  }

  // The reader's own memory between reads: which app gave the heart rate, and what was refused.
  let heartRateApp: string | null = null;
  const blocked = new Set<RunMetric>();
  const noteOutcome = (metric: RunMetric, failed: readonly string[] | undefined) => {
    if (failed?.includes(metric)) blocked.add(metric);
    else blocked.delete(metric);
  };

  return {
    async readHeartRate(sinceMs) {
      if (!readable.includes('heart_rate')) return [];
      const result = await provider.sync({ metricTypes: ['heart_rate'], since: new Date(sinceMs) });
      noteOutcome('heart_rate', result.failedMetricTypes);
      heartRateApp = heartRateOrigin(result.observations) ?? heartRateApp;
      return toHeartRateSamples(result.observations);
    },
    async readActiveEnergyKcal(startMs, endMs) {
      if (!readable.includes('active_energy')) return null;
      const result = await provider.sync({ metricTypes: ['active_energy'], since: new Date(startMs) });
      noteOutcome('active_energy', result.failedMetricTypes);
      return sumActiveEnergyKcal(result.observations, startMs, endMs, heartRateApp);
    },
    blockedMetrics: () => RUN_METRICS.filter((metric) => blocked.has(metric)),
  };
}

export interface FinalHealth {
  heartRate: HeartRateSample[];
  caloriesKcal: number | null;
  /** Metrics Health Connect refused, so the run can say so instead of looking like a quiet watch. */
  blocked: readonly RunMetric[];
}

/** One last read when a run finishes, bounded, and never throwing: the run is saved either way. */
export async function readFinalHealth(
  reader: RunHealthReader | null,
  startMs: number,
  endMs: number,
  timeoutMs: number = FINAL_READ_TIMEOUT_MS,
): Promise<FinalHealth> {
  if (!reader) return { heartRate: [], caloriesKcal: null, blocked: [] };
  const none = (): FinalHealth => ({ heartRate: [], caloriesKcal: null, blocked: reader.blockedMetrics() });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<FinalHealth>((resolve) => {
    timer = setTimeout(() => resolve(none()), timeoutMs);
  });
  // One after the other: the calories are counted from the app that gave the heart rate.
  const read = (async (): Promise<FinalHealth> => {
    const heartRate = await reader.readHeartRate(startMs);
    const caloriesKcal = await reader.readActiveEnergyKcal(startMs, endMs);
    return { heartRate, caloriesKcal, blocked: reader.blockedMetrics() };
  })();
  try {
    return await Promise.race([read, timeout]);
  } catch {
    return none();
  } finally {
    clearTimeout(timer);
  }
}
