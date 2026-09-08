import type { HealthObservationSeriesResponse } from '@forjd/contracts';

import { latestReading, sumForLocalDate } from './health-metrics';

// `sumForLocalDate` buckets by the *device's* local calendar day (its own docblock explains
// why -- it reads `new Date(...)`'s local getters, not `.toISOString()`), and this suite's own
// fixture timestamps must respect that: a point near a UTC day boundary (e.g. 23:00Z) lands on
// the *next* calendar day in any timezone ahead of UTC, which silently broke this suite outside
// a UTC-clocked machine (mutating `process.env.TZ` at runtime does not help -- jest-expo's test
// environment resolves the host timezone once, before test code runs, and does not re-read it).
// Fixtures below stay solidly mid-day UTC instead, which is unambiguous for every timezone this
// project's contributors and CI actually run in.

function response(series: HealthObservationSeriesResponse['series']): HealthObservationSeriesResponse {
  return { series };
}

describe('latestReading', () => {
  it('returns null for a metric type with no series at all', () => {
    expect(latestReading(response([]), 'hrv')).toBeNull();
  });

  it('returns the single point when there is only one', () => {
    const result = latestReading(
      response([{ metricType: 'hrv', unit: 'ms', points: [{ startTime: '2026-09-07T00:00:00.000Z', value: 60 }] }]),
      'hrv',
    );
    expect(result).toEqual({ value: 60, unit: 'ms', startTime: '2026-09-07T00:00:00.000Z' });
  });

  it('returns the most recent point, not the first in the array', () => {
    const result = latestReading(
      response([
        {
          metricType: 'resting_heart_rate',
          unit: 'bpm',
          points: [
            { startTime: '2026-09-05T00:00:00.000Z', value: 50 },
            { startTime: '2026-09-07T00:00:00.000Z', value: 48 },
            { startTime: '2026-09-06T00:00:00.000Z', value: 49 },
          ],
        },
      ]),
      'resting_heart_rate',
    );
    expect(result?.value).toBe(48);
    expect(result?.startTime).toBe('2026-09-07T00:00:00.000Z');
  });
});

describe('sumForLocalDate', () => {
  it('returns null when the metric type has no series', () => {
    expect(sumForLocalDate(response([]), 'steps', '2026-09-07')).toBeNull();
  });

  it('returns null when the metric has readings but none on the given day', () => {
    const result = sumForLocalDate(
      response([{ metricType: 'steps', unit: 'steps', points: [{ startTime: '2026-09-06T12:00:00.000Z', value: 500 }] }]),
      'steps',
      '2026-09-07',
    );
    expect(result).toBeNull();
  });

  it('sums multiple same-day points rather than returning only the latest', () => {
    const result = sumForLocalDate(
      response([
        {
          metricType: 'steps',
          unit: 'steps',
          points: [
            { startTime: '2026-09-07T10:00:00.000Z', value: 1000 },
            { startTime: '2026-09-07T12:00:00.000Z', value: 2500 },
            { startTime: '2026-09-07T14:00:00.000Z', value: 4000 },
          ],
        },
      ]),
      'steps',
      '2026-09-07',
    );
    expect(result).toBe(7500);
  });

  it('excludes points from other days', () => {
    const result = sumForLocalDate(
      response([
        {
          metricType: 'steps',
          unit: 'steps',
          points: [
            { startTime: '2026-09-06T12:00:00.000Z', value: 900 },
            { startTime: '2026-09-07T12:00:00.000Z', value: 100 },
          ],
        },
      ]),
      'steps',
      '2026-09-07',
    );
    expect(result).toBe(100);
  });
});
