import { MIN_COHORT_SIZE } from '@forjd/domain';

import { leaderboardQuerySchema, leaderboardResponseSchema } from './leaderboards';

const row = (over: Record<string, unknown> = {}) => ({
  rank: 47,
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'James M.',
  username: 'jamesm',
  avatarUrl: null,
  score: 92.7,
  delta: 3,
  isSelf: true,
  isPublicProfile: true,
  ...over,
});

const ranked = (over: Record<string, unknown> = {}) => ({
  status: 'ranked',
  metric: 'activity',
  period: 'month',
  city: { name: 'Alexandria', slug: 'alexandria-eg' },
  periodLabel: 'Sep 2026',
  cohortSize: 588,
  minCohortSize: MIN_COHORT_SIZE,
  me: { rank: 47, score: 92.7, topPercent: 8, delta: 3 },
  rows: [row()],
  ...over,
});

const empty = (status: string, over: Record<string, unknown> = {}) => ({
  status,
  metric: 'activity',
  period: 'month',
  city: null,
  periodLabel: 'Sep 2026',
  cohortSize: 0,
  minCohortSize: MIN_COHORT_SIZE,
  me: null,
  rows: [],
  ...over,
});

const NON_RANKED = ['coming_soon', 'not_opted_in', 'no_city', 'no_eligible_sessions', 'cohort_too_small'];

describe('leaderboardQuerySchema', () => {
  it('defaults to activity, this month, and a three-row window either side', () => {
    expect(leaderboardQuerySchema.parse({})).toEqual({ metric: 'activity', period: 'month', window: 3 });
  });

  it('coerces the window from a query-string value', () => {
    expect(leaderboardQuerySchema.parse({ window: '5' }).window).toBe(5);
  });

  it('accepts a window of 0 and of 10', () => {
    expect(leaderboardQuerySchema.parse({ window: '0' }).window).toBe(0);
    expect(leaderboardQuerySchema.parse({ window: '10' }).window).toBe(10);
  });

  it('rejects a window of 11, -1 or 2.5', () => {
    for (const window of ['11', '-1', '2.5']) {
      expect(leaderboardQuerySchema.safeParse({ window }).success).toBe(false);
    }
  });

  it('rejects an empty, blank, fractional or array window instead of reading it as 0', () => {
    for (const window of ['', ' ', '1e1', '+3', ['3']]) {
      expect(leaderboardQuerySchema.safeParse({ window }).success).toBe(false);
    }
  });

  it('rejects an unknown metric or period', () => {
    expect(leaderboardQuerySchema.safeParse({ metric: 'crossfit' }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ period: 'week' }).success).toBe(false);
  });

  it('accepts every metric and period the design offers', () => {
    for (const metric of ['activity', 'strength', 'running', 'hyrox']) {
      for (const period of ['month', 'all_time']) {
        expect(leaderboardQuerySchema.safeParse({ metric, period }).success).toBe(true);
      }
    }
  });
});

describe('leaderboardResponseSchema', () => {
  it('parses a ranked board', () => {
    expect(leaderboardResponseSchema.safeParse(ranked()).success).toBe(true);
  });

  it('parses a null delta, the state before any weekly snapshot exists', () => {
    const parsed = leaderboardResponseSchema.safeParse(
      ranked({ me: { rank: 47, score: 92.7, topPercent: 8, delta: null }, rows: [row({ delta: null })] }),
    );
    expect(parsed.success).toBe(true);
  });

  it('accepts a negative delta for a fall in rank', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ delta: -1 })] })).success).toBe(true);
  });

  it('parses coming_soon with no rows and no me', () => {
    expect(leaderboardResponseSchema.safeParse(empty('coming_soon', { metric: 'strength' })).success).toBe(true);
  });

  it.each(['not_opted_in', 'no_city', 'no_eligible_sessions'])('parses %s with no rows and no me', (status) => {
    expect(leaderboardResponseSchema.safeParse(empty(status)).success).toBe(true);
  });

  it('parses cohort_too_small carrying the real cohort size', () => {
    const parsed = leaderboardResponseSchema.safeParse(
      empty('cohort_too_small', { city: { name: 'Alexandria', slug: 'alexandria-eg' }, cohortSize: 4 }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects a ranked board with no rows', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [] })).success).toBe(false);
  });

  it('rejects a ranked board with no me', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ me: null })).success).toBe(false);
  });

  it('rejects a ranked board with no city', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ city: null })).success).toBe(false);
  });

  it('rejects a ranked board whose cohort is under the minimum', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ cohortSize: MIN_COHORT_SIZE - 1 })).success).toBe(false);
  });

  it('rejects any non-ranked status that carries rows, so a number can never ride along', () => {
    for (const status of NON_RANKED) {
      expect(leaderboardResponseSchema.safeParse(empty(status, { rows: [row()] })).success).toBe(false);
    }
  });

  it('rejects any non-ranked status that carries me', () => {
    const me = { rank: 1, score: 50, topPercent: 1, delta: null };
    for (const status of NON_RANKED) {
      expect(leaderboardResponseSchema.safeParse(empty(status, { me })).success).toBe(false);
    }
  });

  it('rejects a score outside 0..100', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ score: 100.1 })] })).success).toBe(false);
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ score: -1 })] })).success).toBe(false);
  });

  it('rejects a non-integer or non-positive rank', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ rank: 0 })] })).success).toBe(false);
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ rank: 1.5 })] })).success).toBe(false);
  });

  it('rejects a userId that is not a uuid', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ userId: 'nope' })] })).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(leaderboardResponseSchema.safeParse(empty('mystery')).success).toBe(false);
  });

  it('shows name and username on a private-profile row, which is simply not tappable', () => {
    const parsed = leaderboardResponseSchema.safeParse(ranked({ rows: [row({ isPublicProfile: false })] }));
    expect(parsed.success).toBe(true);
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ displayName: undefined })] })).success).toBe(
      false,
    );
  });

  it('requires exactly one self row', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ isSelf: false })] })).success).toBe(false);
    const twoSelves = [row(), row({ rank: 48, userId: '22222222-2222-4222-8222-222222222222' })];
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: twoSelves })).success).toBe(false);
  });

  it('requires the self row to agree with me on rank and score', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ rank: 48 })] })).success).toBe(false);
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [row({ score: 10 })] })).success).toBe(false);
  });

  it('requires rows to be contiguous and ascending', () => {
    const other = (rank: number) =>
      row({ rank, isSelf: false, userId: `00000000-0000-4000-8000-0000000000${rank}` });
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [other(50), row()] })).success).toBe(false);
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [other(44), row()] })).success).toBe(false);
    expect(leaderboardResponseSchema.safeParse(ranked({ rows: [other(46), row(), other(48)] })).success).toBe(true);
  });

  it('rejects a rank beyond the cohort', () => {
    const me = { rank: 900, score: 92.7, topPercent: 8, delta: 3 };
    expect(
      leaderboardResponseSchema.safeParse(ranked({ me, rows: [row({ rank: 900 })] })).success,
    ).toBe(false);
  });

  it('pins minCohortSize to the domain constant', () => {
    expect(leaderboardResponseSchema.safeParse(ranked({ minCohortSize: 1 })).success).toBe(false);
  });

  it('requires cohort_too_small to name a city and a cohort under the minimum', () => {
    const city = { name: 'Alexandria', slug: 'alexandria-eg' };
    expect(leaderboardResponseSchema.safeParse(empty('cohort_too_small', { city, cohortSize: 500 })).success).toBe(
      false,
    );
    expect(leaderboardResponseSchema.safeParse(empty('cohort_too_small', { city: null, cohortSize: 4 })).success).toBe(
      false,
    );
  });

  it('accepts several rows around the caller', () => {
    const rows = [row({ rank: 46, isSelf: false }), row(), row({ rank: 48, isSelf: false })];
    expect(leaderboardResponseSchema.safeParse(ranked({ rows })).success).toBe(true);
  });
});
