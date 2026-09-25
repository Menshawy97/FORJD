// The calorie estimate needs a body weight (plan formulas). It comes from the newest reading across
// Health Connect / manual observations and InBody scans. None on record means no estimate.
import { pickLatestBmrKcal, pickLatestWeightKg, runCalorieProfile } from '../latest-weight';

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

// scan-height-age-plan.md §4.4: resting energy comes from the latest scan's BMR, and Keytel's
// heart-rate equation needs the person's age on the run's date and their sex.
describe('pickLatestBmrKcal', () => {
  const bmr = (points: Array<{ measuredAt: string; value: number }>) => ({
    series: [{ metric: 'basal_metabolic_rate_kcal', unit: 'kcal', points }],
  });

  it("takes the newest scan's BMR", () => {
    const series = bmr([
      { measuredAt: '2026-08-01T08:00:00.000Z', value: 1850 },
      { measuredAt: '2026-09-20T08:00:00.000Z', value: 1905 },
    ]);
    expect(pickLatestBmrKcal(series as never)).toBe(1905);
  });

  it('is null without one, or with an implausible value', () => {
    expect(pickLatestBmrKcal(null)).toBeNull();
    expect(pickLatestBmrKcal(bmr([{ measuredAt: '2026-09-20T08:00:00.000Z', value: 90 }]) as never)).toBeNull();
  });
});

describe('runCalorieProfile', () => {
  const me = (profile: { dateOfBirth: string | null; sex: string | null } | null) => ({ profile });

  it("gives the age on the run's date and the profile's sex", () => {
    expect(runCalorieProfile(me({ dateOfBirth: '1994-09-26', sex: 'male' }) as never, new Date('2026-09-25T08:00:00.000Z'))).toEqual({
      ageYears: 31,
      sex: 'male',
    });
  });

  it('is empty without a profile or a date of birth', () => {
    expect(runCalorieProfile(null, new Date())).toEqual({ ageYears: null, sex: null });
    expect(runCalorieProfile(me({ dateOfBirth: null, sex: 'female' }) as never, new Date())).toEqual({ ageYears: null, sex: 'female' });
  });
});
