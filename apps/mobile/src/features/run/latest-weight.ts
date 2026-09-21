import type { BodyScanSeriesResponse, HealthObservationSeriesResponse } from '@forjd/contracts';

import { getBodyScanSeries, getHealthObservationSeries } from '@/auth/apiClient';

/**
 * The person's latest body weight, for the run's calorie estimate (`live-run-plan.md`, Formulas).
 * The newest reading across Health Connect / manual observations and InBody scans wins. None on
 * record means no estimate, and the calories tile reads a dash.
 *
 * Kilograms only, and only a plausible body weight: a series in another unit or a stray value is
 * ignored rather than converted, so a bad reading can never silently skew a calorie figure.
 */
const MIN_PLAUSIBLE_KG = 20;
const MAX_PLAUSIBLE_KG = 400;
const LOOKUP_TIMEOUT_MS = 3000;

interface Reading {
  atMs: number;
  kg: number;
}

const isPlausible = (kg: number): boolean =>
  Number.isFinite(kg) && kg >= MIN_PLAUSIBLE_KG && kg <= MAX_PLAUSIBLE_KG;

function newest(readings: readonly Reading[]): Reading | null {
  return readings.reduce<Reading | null>((best, r) => (best === null || r.atMs > best.atMs ? r : best), null);
}

function healthReadings(response: HealthObservationSeriesResponse | null): Reading[] {
  const series = response?.series.find((s) => s.metricType === 'weight');
  if (!series || series.unit !== 'kg') return [];
  return series.points
    .map((p) => ({ atMs: Date.parse(p.startTime), kg: p.value }))
    .filter((r) => Number.isFinite(r.atMs) && isPlausible(r.kg));
}

function bodyReadings(response: BodyScanSeriesResponse | null): Reading[] {
  const series = response?.series.find((s) => s.metric === 'weight_kg');
  if (!series || series.unit !== 'kg') return [];
  return series.points
    .map((p) => ({ atMs: Date.parse(p.measuredAt), kg: p.value }))
    .filter((r) => Number.isFinite(r.atMs) && isPlausible(r.kg));
}

export function pickLatestWeightKg(
  health: HealthObservationSeriesResponse | null,
  body: BodyScanSeriesResponse | null,
): number | null {
  return newest([...healthReadings(health), ...bodyReadings(body)])?.kg ?? null;
}

const settled = async <T>(request: Promise<T>): Promise<T | null> => {
  try {
    return await request;
  } catch {
    return null;
  }
};

/**
 * Best effort and bounded: it is asked once, when a run is finished, and a slow or missing network
 * must not hold the run back (CLAUDE.md rule 6), so it gives up after a few seconds and the run is
 * saved without an estimate. Never throws.
 */
export async function fetchLatestWeightKg(): Promise<number | null> {
  const lookup = Promise.all([settled(getHealthObservationSeries()), settled(getBodyScanSeries())]).then(
    ([health, body]) => pickLatestWeightKg(health, body),
  );
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS));
  try {
    return await Promise.race([lookup, timeout]);
  } catch {
    return null;
  }
}
