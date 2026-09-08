import type { HealthMetricSeries, HealthObservationSeriesResponse } from '@forjd/contracts';
import type { HealthMetricType } from '@forjd/domain';

/** One metric's most recent reading, in whatever unit `HEALTH_METRIC_UNITS` (server-side,
 *  @forjd/domain) already normalized it to before it reached this response. */
export interface MetricReading {
  value: number;
  unit: string;
  startTime: string;
}

function seriesFor(response: HealthObservationSeriesResponse, metricType: HealthMetricType): HealthMetricSeries | null {
  return response.series.find((s) => s.metricType === metricType) ?? null;
}

/**
 * The most recent point for one metric type, or `null` if it has never been measured. Used
 * for instantaneous readings (HRV, resting heart rate) where "latest" is the only reading
 * that matters -- unlike steps, which accumulate across a day (see `sumForLocalDate` below).
 */
export function latestReading(response: HealthObservationSeriesResponse, metricType: HealthMetricType): MetricReading | null {
  const series = seriesFor(response, metricType);
  if (series === null || series.points.length === 0) return null;

  const latest = series.points.reduce((a, b) => (a.startTime > b.startTime ? a : b));
  return { value: latest.value, unit: series.unit, startTime: latest.startTime };
}

/**
 * Sums every point for one metric type whose `startTime` falls on the given local calendar
 * day (`YYYY-MM-DD`, `todayLocalDate()`'s own format) -- steps is the motivating case: Health
 * Connect reports steps as many small time-bucketed records across a day, not one daily total,
 * so "steps so far today" is a sum, not a latest-point read the way HRV/RHR are.
 *
 * `new Date(point.startTime)`'s local getters (not `.toISOString()`) are what makes this
 * device-timezone-correct, mirroring `todayLocalDate()`'s own reasoning.
 *
 * Returns `null` (not `0`) when there are no points at all for that day -- "never measured
 * today" and "measured zero" are different honest states, and the caller renders both the
 * same way today (an em dash), but the distinction is real and a future caller may not want
 * to collapse it.
 */
export function sumForLocalDate(
  response: HealthObservationSeriesResponse,
  metricType: HealthMetricType,
  localDate: string,
): number | null {
  const series = seriesFor(response, metricType);
  if (series === null) return null;

  const matching = series.points.filter((p) => localDateOf(p.startTime) === localDate);
  if (matching.length === 0) return null;

  return matching.reduce((sum, p) => sum + p.value, 0);
}

/** "7h 28m" for 448 minutes -- shared by the stat strip and the readiness card, both of which
 *  render a sleep-duration reading in the design's own wording. */
export function formatSleepMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return `${hours}h ${remainder}m`;
}

function localDateOf(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
