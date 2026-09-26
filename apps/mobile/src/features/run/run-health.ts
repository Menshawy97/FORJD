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

export interface RunHealthReader {
  readHeartRate(sinceMs: number): Promise<HeartRateSample[]>;
  readActiveEnergyKcal(startMs: number, endMs: number): Promise<number | null>;
}

/** Heart-rate readings as run samples, stamped at their start. Other metrics are ignored. */
export function toHeartRateSamples(observations: readonly SyncedObservation[]): HeartRateSample[] {
  return observations
    .filter((o) => o.metricType === 'heart_rate')
    .map((o) => ({ timestampMs: o.startTime.getTime(), bpm: o.value }));
}

/**
 * The watch's active energy for the run: the records that start inside it, in kilocalories. `null`
 * when it reported none, so the run falls back to the estimate rather than showing a zero.
 */
export function sumActiveEnergyKcal(
  observations: readonly SyncedObservation[],
  startMs: number,
  endMs: number,
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
  const total = inRun.reduce((sum, o) => sum + o.value, 0);
  return Math.min(MAX_PLAUSIBLE_RUN_KCAL, Math.round(total));
}

export interface RunHealthAccess {
  /** Whether Health Connect was already asked on this phone; if so it is not asked again. */
  alreadyAsked: boolean;
  markAsked: () => Promise<void>;
}

const RUN_METRICS = ['heart_rate', 'active_energy'] as const;
type RunMetric = (typeof RUN_METRICS)[number];

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

  return {
    async readHeartRate(sinceMs) {
      if (!readable.includes('heart_rate')) return [];
      const result = await provider.sync({ metricTypes: ['heart_rate'], since: new Date(sinceMs) });
      return toHeartRateSamples(result.observations);
    },
    async readActiveEnergyKcal(startMs, endMs) {
      if (!readable.includes('active_energy')) return null;
      const result = await provider.sync({ metricTypes: ['active_energy'], since: new Date(startMs) });
      return sumActiveEnergyKcal(result.observations, startMs, endMs);
    },
  };
}

export interface FinalHealth {
  heartRate: HeartRateSample[];
  caloriesKcal: number | null;
}

/** One last read when a run finishes, bounded, and never throwing: the run is saved either way. */
export async function readFinalHealth(
  reader: RunHealthReader | null,
  startMs: number,
  endMs: number,
  timeoutMs: number = FINAL_READ_TIMEOUT_MS,
): Promise<FinalHealth> {
  const none: FinalHealth = { heartRate: [], caloriesKcal: null };
  if (!reader) return none;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<FinalHealth>((resolve) => {
    timer = setTimeout(() => resolve(none), timeoutMs);
  });
  const read = Promise.all([reader.readHeartRate(startMs), reader.readActiveEnergyKcal(startMs, endMs)]).then(
    ([heartRate, caloriesKcal]): FinalHealth => ({ heartRate, caloriesKcal }),
  );
  try {
    return await Promise.race([read, timeout]);
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}
