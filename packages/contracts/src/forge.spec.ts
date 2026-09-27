import {
  featureFlagsResponseSchema,
  forgePendingWeeksResponseSchema,
  forgeResponseSchema,
  forgeWeekParamsSchema,
  publicForgeSchema,
  timeZoneUpdateRequestSchema,
} from './forge';

const ladder = {
  ladder: 'volume',
  unit: 'kg',
  band: 'ore',
  level: 2,
  maxLevel: 15,
  target: 3000,
  total: 1200,
  progress: 0.4,
  missStreak: 0,
  temperedHoldWeeks: 0,
  forgedStreak: 0,
  bestForgedStreak: 0,
  badges: ['ore'],
};

describe('forgeResponseSchema', () => {
  it('accepts the current week with every ladder', () => {
    expect(
      forgeResponseSchema.safeParse({ weekStart: '2026-09-26', daysLeft: 4, timeZone: 'Africa/Cairo', ladders: [ladder] })
        .success,
    ).toBe(true);
  });

  it('treats the Tempered hold as optional, so an API from before it existed still parses', () => {
    const withoutHold = Object.fromEntries(Object.entries(ladder).filter(([key]) => key !== 'temperedHoldWeeks'));
    const parse = (ladders: unknown[]) =>
      forgeResponseSchema.safeParse({ weekStart: '2026-09-26', daysLeft: 4, timeZone: 'UTC', ladders });

    expect(parse([withoutHold]).success).toBe(true);
    expect(parse([{ ...ladder, temperedHoldWeeks: 3 }]).success).toBe(true);
    expect(parse([{ ...ladder, temperedHoldWeeks: -1 }]).success).toBe(false);
    expect(parse([{ ...ladder, temperedHoldWeeks: 1.5 }]).success).toBe(false);
  });

  it('keeps progress between 0 and 1 and days left between 1 and 7', () => {
    expect(forgeResponseSchema.safeParse({ weekStart: '2026-09-26', daysLeft: 0, timeZone: 'UTC', ladders: [] }).success).toBe(
      false,
    );
    expect(
      forgeResponseSchema.safeParse({
        weekStart: '2026-09-26',
        daysLeft: 3,
        timeZone: 'UTC',
        ladders: [{ ...ladder, progress: 1.2 }],
      }).success,
    ).toBe(false);
  });
});

describe('forgePendingWeeksResponseSchema', () => {
  it('accepts a closed week with its biggest celebration and every ladder', () => {
    const week = {
      weekStart: '2026-09-19',
      biggest: 'band',
      biggestLadder: 'volume',
      shareable: true,
      levelsGained: 1,
      marksEarned: 1,
      ladders: [
        {
          ladder: 'volume',
          outcome: 'hit',
          levelBefore: 6,
          levelAfter: 7,
          bandBefore: 'ore',
          bandAfter: 'ember',
          total: 5100,
          target: 5000,
          celebration: 'band',
          rewards: [{ type: 'band_badge', level: 7, band: 'ember' }],
        },
      ],
    };
    expect(forgePendingWeeksResponseSchema.safeParse({ weeks: [week] }).success).toBe(true);
  });
});

describe('forgeWeekParamsSchema', () => {
  it('accepts a date and rejects anything else', () => {
    expect(forgeWeekParamsSchema.safeParse({ weekStart: '2026-09-19' }).success).toBe(true);
    expect(forgeWeekParamsSchema.safeParse({ weekStart: '19-09-2026' }).success).toBe(false);
    expect(forgeWeekParamsSchema.safeParse({ weekStart: "2026-09-19'; drop table" }).success).toBe(false);
  });
});

describe('publicForgeSchema', () => {
  it('never carries Nourish, which is private', () => {
    const entry = { ladder: 'nourish', band: 'anvil', level: 6, forgedStreak: 0, bestForgedStreak: 0, badges: [] };
    expect(publicForgeSchema.safeParse({ ladders: [entry] }).success).toBe(false);
    expect(publicForgeSchema.safeParse({ ladders: [{ ...entry, ladder: 'distance' }] }).success).toBe(true);
  });
});

describe('timeZoneUpdateRequestSchema', () => {
  it('accepts an IANA zone and rejects anything else', () => {
    expect(timeZoneUpdateRequestSchema.safeParse({ timeZone: 'Africa/Cairo' }).success).toBe(true);
    expect(timeZoneUpdateRequestSchema.safeParse({ timeZone: 'Mars/Olympus' }).success).toBe(false);
    expect(timeZoneUpdateRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('featureFlagsResponseSchema', () => {
  it('is the list of enabled flag keys', () => {
    expect(featureFlagsResponseSchema.safeParse({ enabled: ['weekly_forge'] }).success).toBe(true);
  });
});
