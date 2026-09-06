import {
  progressStrengthQuerySchema,
  progressStrengthResponseSchema,
} from './index';

describe('progress contracts', () => {
  const validRecord = {
    exerciseId: '11111111-1111-1111-1111-111111111111',
    exerciseName: 'Back Squat',
    weightKg: 140,
    reps: 1,
    achievedAt: '2026-08-19T09:00:00.000Z',
    deltaKgSinceLastMonth: 7.5,
  };

  const validResponse = {
    personalRecords: [validRecord],
    oneRepMaxTrend: [
      { weekStart: '2026-07-06', estimatedOneRepMaxKg: 88 },
      { weekStart: '2026-08-24', estimatedOneRepMaxKg: 100 },
    ],
    weeklyVolumeKg: [
      { dayOfWeek: 1, volumeKg: 8200 },
      { dayOfWeek: 2, volumeKg: 6100 },
      { dayOfWeek: 3, volumeKg: 0 },
      { dayOfWeek: 4, volumeKg: 0 },
      { dayOfWeek: 5, volumeKg: 9400 },
      { dayOfWeek: 6, volumeKg: 4200 },
      { dayOfWeek: 7, volumeKg: 0 },
    ],
    trainingCalendar: {
      month: '2026-08',
      days: [{ date: '2026-08-03', activity: 'strength' }],
      daysTrained: 13,
    },
    muscleSplit: [{ bucket: 'legs', percent: 28 }],
    insight: { headline: 'Training volume up 14% this week.', body: 'Total load moved with it.' },
  };

  describe('progressStrengthQuerySchema', () => {
    it('defaults timeZone to UTC', () => {
      expect(progressStrengthQuerySchema.parse({})).toEqual({ timeZone: 'UTC' });
    });

    it('rejects a made-up time zone the way the stats query already does', () => {
      expect(progressStrengthQuerySchema.safeParse({ timeZone: 'Not/AZone' }).success).toBe(false);
    });
  });

  describe('progressStrengthResponseSchema', () => {
    it('parses the fully-populated shape', () => {
      expect(progressStrengthResponseSchema.safeParse(validResponse).success).toBe(true);
    });

    it('parses the honest-empty shape a brand new account produces', () => {
      const empty = {
        personalRecords: [],
        oneRepMaxTrend: [],
        weeklyVolumeKg: [
          { dayOfWeek: 1, volumeKg: 0 },
          { dayOfWeek: 2, volumeKg: 0 },
          { dayOfWeek: 3, volumeKg: 0 },
          { dayOfWeek: 4, volumeKg: 0 },
          { dayOfWeek: 5, volumeKg: 0 },
          { dayOfWeek: 6, volumeKg: 0 },
          { dayOfWeek: 7, volumeKg: 0 },
        ],
        trainingCalendar: { month: '2026-08', days: [], daysTrained: 0 },
        muscleSplit: [],
        insight: null,
      };
      expect(progressStrengthResponseSchema.safeParse(empty).success).toBe(true);
    });

    it('caps personalRecords at two -- the design shows exactly two PR tiles', () => {
      const threeRecords = { ...validResponse, personalRecords: [validRecord, validRecord, validRecord] };
      expect(progressStrengthResponseSchema.safeParse(threeRecords).success).toBe(false);
    });

    it('keeps volume in kilograms, never a co-travelling unit field', () => {
      const shape = progressStrengthResponseSchema.shape.weeklyVolumeKg.element.shape;
      expect(shape).not.toHaveProperty('unit');
      expect(shape.volumeKg).toBeDefined();
    });

    it('rejects an unknown muscle-split bucket', () => {
      const invalid = { ...validResponse, muscleSplit: [{ bucket: 'wings', percent: 100 }] };
      expect(progressStrengthResponseSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects an unknown training-calendar activity', () => {
      const invalid = {
        ...validResponse,
        trainingCalendar: { ...validResponse.trainingCalendar, days: [{ date: '2026-08-03', activity: 'yoga' }] },
      };
      expect(progressStrengthResponseSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects a weekly-volume day index outside 1-7', () => {
      const invalid = { ...validResponse, weeklyVolumeKg: [{ dayOfWeek: 8, volumeKg: 100 }] };
      expect(progressStrengthResponseSchema.safeParse(invalid).success).toBe(false);
    });

    it('allows insight to be null -- the honest empty state for too little history', () => {
      expect(progressStrengthResponseSchema.safeParse({ ...validResponse, insight: null }).success).toBe(true);
    });

    it('rejects a negative muscle-split percent', () => {
      const invalid = { ...validResponse, muscleSplit: [{ bucket: 'legs', percent: -1 }] };
      expect(progressStrengthResponseSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
