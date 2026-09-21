// The calorie estimate needs a body weight (plan formulas). It comes from the newest reading across
// Health Connect / manual observations and InBody scans. None on record means no estimate.
import { pickLatestWeightKg } from '../latest-weight';

const health = (points: Array<{ startTime: string; value: number }>, unit = 'kg') => ({
  series: [{ metricType: 'weight', unit, points }],
});
const body = (points: Array<{ measuredAt: string; value: number }>, unit = 'kg') => ({
  series: [{ metric: 'weight_kg', unit, points }],
});

describe('pickLatestWeightKg', () => {
  it('takes the newest reading across both sources', () => {
    const result = pickLatestWeightKg(
      health([{ startTime: '2026-09-01T08:00:00.000Z', value: 71 }]) as never,
      body([{ measuredAt: '2026-09-10T08:00:00.000Z', value: 69.5 }]) as never,
    );
    expect(result).toBe(69.5);
  });

  it('uses whichever source exists', () => {
    expect(pickLatestWeightKg(null, body([{ measuredAt: '2026-09-10T08:00:00.000Z', value: 80 }]) as never)).toBe(80);
    expect(pickLatestWeightKg(health([{ startTime: '2026-09-10T08:00:00.000Z', value: 65 }]) as never, null)).toBe(65);
  });

  it('is null with nothing on record', () => {
    expect(pickLatestWeightKg(null, null)).toBeNull();
    expect(pickLatestWeightKg({ series: [] } as never, { series: [] } as never)).toBeNull();
  });

  it('ignores a series that is not in kilograms and values that are not a plausible body weight', () => {
    expect(pickLatestWeightKg(health([{ startTime: '2026-09-10T08:00:00.000Z', value: 150 }], 'lb') as never, null)).toBeNull();
    expect(pickLatestWeightKg(health([{ startTime: '2026-09-10T08:00:00.000Z', value: 3 }]) as never, null)).toBeNull();
  });
});
