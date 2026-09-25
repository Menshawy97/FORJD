import type { BodyScanSeriesResponse, HealthObservationSeriesResponse, MeResponse } from '@forjd/contracts';
import { ageInYears } from '@forjd/domain';

import { getBodyScanSeries, getHealthObservationSeries, getMe } from '@/auth/apiClient';

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

/** The request contract's own BMR range: anything outside it is a stray value, not a resting rate. */
const MIN_PLAUSIBLE_BMR = 500;
const MAX_PLAUSIBLE_BMR = 5000;

/**
 * The newest scan's basal metabolic rate, for the run's resting energy (scan-height-age-plan.md
 * §4.4). Measured or calculated alike: both are the scan's best figure. Null without one.
 */
export function pickLatestBmrKcal(body: BodyScanSeriesResponse | null): number | null {
  const series = body?.series.find((s) => s.metric === 'basal_metabolic_rate_kcal');
  const readings = (series?.points ?? [])
    .map((p) => ({ atMs: Date.parse(p.measuredAt), kg: p.value }))
    .filter((r) => Number.isFinite(r.atMs) && r.kg >= MIN_PLAUSIBLE_BMR && r.kg <= MAX_PLAUSIBLE_BMR);
  return newest(readings)?.kg ?? null;
}

export interface RunPerson {
  ageYears: number | null;
  sex: 'male' | 'female' | 'prefer_not_to_say' | null;
}

/** Age on the run's date and sex from the profile, for Keytel's heart-rate equation (§4.4). */
export function runCalorieProfile(me: MeResponse | null, runDate: Date): RunPerson {
  const profile = me?.profile ?? null;
  return {
    ageYears: profile?.dateOfBirth ? ageInYears(profile.dateOfBirth, runDate) : null,
    sex: profile?.sex ?? null,
  };
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

export interface RunCalorieInputs extends RunPerson {
  weightKg: number | null;
  bmrKcal: number | null;
}

/**
 * Everything the run's calorie estimate uses (scan-height-age-plan.md §4.4): weight, the latest
 * scan's BMR, and age and sex from the profile.
 *
 * Best effort and bounded: it is asked once, when a run is finished, and a slow or missing network
 * must not hold the run back (CLAUDE.md rule 6), so it gives up after a few seconds and the run is
 * saved without an estimate. Never throws.
 */
export async function fetchRunCalorieInputs(runDate: Date): Promise<RunCalorieInputs> {
  const none: RunCalorieInputs = { weightKg: null, bmrKcal: null, ageYears: null, sex: null };
  const lookup = Promise.all([settled(getHealthObservationSeries()), settled(getBodyScanSeries()), settled(getMe())]).then(
    ([health, body, me]) => ({
      weightKg: pickLatestWeightKg(health, body),
      bmrKcal: pickLatestBmrKcal(body),
      ...runCalorieProfile(me, runDate),
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RunCalorieInputs>((resolve) => {
    timer = setTimeout(() => resolve(none), LOOKUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([lookup, timeout]);
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}
