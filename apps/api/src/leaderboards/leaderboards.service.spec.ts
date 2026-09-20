import { leaderboardResponseSchema, LeaderboardQuery } from '@forjd/contracts';
import { MIN_COHORT_SIZE, PrivacySettings, User } from '@forjd/domain';

import type { CityResolverService } from '../cities/city-resolver.service';
import type { PrivacyService } from '../privacy/privacy.service';
import type { LeaderboardSnapshotRepository } from './leaderboard-snapshot.repository';
import { CityAthleteRow, LeaderboardsRepository } from './leaderboards.repository';
import { LeaderboardsService } from './leaderboards.service';

const NOW = new Date('2026-09-21T21:00:00Z'); // exactly 21 days (3 weeks) into September in Cairo
const SLUG = 'alexandria-eg-361058';
const viewer: User = { id: '00000000-0000-4000-8000-000000000999', email: 'v@example.com', createdAt: new Date(), updatedAt: new Date() };

const query = (over: Partial<LeaderboardQuery> = {}): LeaderboardQuery => ({
  metric: 'activity',
  period: 'month',
  window: 3,
  ...over,
});

const idOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Athlete n. Higher n trained more, so rank order is n descending. */
const athleteRow = (n: number, over: Partial<CityAthleteRow> = {}): CityAthleteRow => ({
  userId: idOf(n),
  firstStartedAt: new Date('2026-09-02T10:00:00Z'),
  workingSeconds: n * 600,
  volumeKg: n * 500,
  distanceKm: 0,
  strengthDays: Math.min(n, 8),
  displayName: `Athlete ${n}`,
  username: `ath${n}`,
  avatarUrl: null,
  isPublicProfile: true,
  ...over,
});

/** `count` athletes numbered 1..count, with the viewer as number `viewerN`. */
const cohort = (count: number, viewerN: number): CityAthleteRow[] =>
  Array.from({ length: count }, (_, i) => athleteRow(i + 1, i + 1 === viewerN ? { userId: viewer.id } : {}));

describe('LeaderboardsService', () => {
  const privacyDefaults: Partial<PrivacySettings> = { leaderboardOptIn: true, locationForLeaderboard: true };

  const build = (
    options: {
      privacy?: Partial<PrivacySettings>;
      latest?: { citySlug: string; city: string | null } | null;
      athletes?: CityAthleteRow[];
      city?: { name: string; slug: string; countryCode: string; timezone: string } | null;
      baseline?: Map<string, number>;
    } = {},
  ) => {
    const privacyCalls: string[] = [];
    const privacy = {
      get: (userId: string) => {
        privacyCalls.push(userId);
        return Promise.resolve({ ...privacyDefaults, ...options.privacy } as PrivacySettings);
      },
    } as unknown as PrivacyService;

    const repository = {
      latestEligibleCity: jest.fn().mockResolvedValue(options.latest === undefined ? { citySlug: SLUG, city: 'Alexandria' } : options.latest),
      cityAthletes: jest.fn().mockResolvedValue(options.athletes ?? []),
    };

    const cities = {
      findBySlug: jest.fn().mockReturnValue(
        options.city === undefined
          ? { name: 'Alexandria', slug: SLUG, countryCode: 'EG', timezone: 'Africa/Cairo' }
          : options.city,
      ),
    };

    const snapshots = { baselineRanks: jest.fn().mockResolvedValue(options.baseline ?? new Map<string, number>()) };

    const service = new LeaderboardsService(
      repository as unknown as LeaderboardsRepository,
      privacy,
      cities as unknown as CityResolverService,
      snapshots as unknown as LeaderboardSnapshotRepository,
    );
    return { service, repository, cities, snapshots, privacyCalls };
  };

  const get = (service: LeaderboardsService, over: Partial<LeaderboardQuery> = {}) => service.get(viewer, query(over), NOW);

  describe('standingFor (the public profile tiles)', () => {
    it("returns the athlete's rank, score, city and window on the month board", async () => {
      const { service } = build({ athletes: cohort(10, 5) });

      const standing = await service.standingFor(viewer.id, NOW);

      // Athlete number 5 of 10 is ranked 6th (higher n trained more).
      expect(standing).toEqual({
        cityName: 'Alexandria',
        citySlug: SLUG,
        rank: 6,
        score: expect.any(Number),
        periodLabel: 'Sep 2026',
      });
    });

    it('asks for the month board with no neighbours, for the athlete it is given', async () => {
      const { service, privacyCalls } = build({ athletes: cohort(10, 5) });

      await service.standingFor(viewer.id, NOW);

      expect(privacyCalls).toEqual([viewer.id]);
    });

    it.each([
      ['has not joined', { privacy: { leaderboardOptIn: false } }],
      ['has no city yet', { latest: null }],
      ['is in a city below the minimum', { athletes: cohort(MIN_COHORT_SIZE - 1, 2) }],
    ])('is null for an athlete who %s', async (_label, options) => {
      const { service } = build(options as Parameters<typeof build>[0]);

      expect(await service.standingFor(viewer.id, NOW)).toBeNull();
    });

    it('defaults to the current time', async () => {
      const { service } = build({ athletes: cohort(10, 5) });

      expect((await service.standingFor(viewer.id))?.rank).toBeGreaterThan(0);
    });
  });

  describe('a ranked board', () => {
    it('ranks the city, marks the caller, and centres the window on them (44-50 for 47th in the design)', async () => {
      const { service } = build({ athletes: cohort(60, 20) });

      const result = await get(service);

      // Athlete n has rank 61 - n, so the viewer (number 20) is 41st.
      expect(result.status).toBe('ranked');
      expect(result.me?.rank).toBe(41);
      expect(result.rows.map((r) => r.rank)).toEqual([38, 39, 40, 41, 42, 43, 44]);
      expect(result.rows.filter((r) => r.isSelf)).toHaveLength(1);
      expect(result.rows.find((r) => r.isSelf)?.rank).toBe(41);
      expect(result.cohortSize).toBe(60);
    });

    it('agrees with itself: me is the self row, and the score matches', async () => {
      const { service } = build({ athletes: cohort(20, 7) });

      const result = await get(service);

      const self = result.rows.find((r) => r.isSelf);
      expect(self?.rank).toBe(result.me?.rank);
      expect(self?.score).toBe(result.me?.score);
    });

    it('names the city and the period, and echoes the metric, period and minimum', async () => {
      const { service } = build({ athletes: cohort(10, 5) });

      const result = await get(service);

      expect(result).toMatchObject({
        city: { name: 'Alexandria', slug: SLUG },
        periodLabel: 'Sep 2026',
        metric: 'activity',
        period: 'month',
        minCohortSize: MIN_COHORT_SIZE,
      });
    });

    it('reads the top percent from the rank and the size of the city', async () => {
      const { service } = build({ athletes: cohort(100, 100) });

      // The viewer is athlete 100, so rank 1 of 100.
      expect((await get(service)).me?.topPercent).toBe(1);
    });

    it('keeps the list the same height at the top: 2nd of many shows 1-7 with a window of 3', async () => {
      const { service } = build({ athletes: cohort(30, 29) });

      const result = await get(service);

      expect(result.me?.rank).toBe(2);
      expect(result.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('shows only the caller for a window of zero', async () => {
      const { service } = build({ athletes: cohort(30, 10) });

      const result = await get(service, { window: 0 });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.isSelf).toBe(true);
    });

    it('shows everyone when the whole city fits inside the window', async () => {
      const { service } = build({ athletes: cohort(6, 3) });

      expect((await get(service)).rows).toHaveLength(6);
    });

    it('has no weekly movement when nothing was captured yet: every delta is null', async () => {
      const { service } = build({ athletes: cohort(10, 5) });

      const result = await get(service);

      expect(result.me?.delta).toBeNull();
      expect(result.rows.every((r) => r.delta === null)).toBe(true);
    });

    describe('weekly movement', () => {
      // Athlete n is ranked 11 - n of 10, so the viewer (number 5) is 6th.
      const baseline = new Map<string, number>([
        [viewer.id, 9], // was 9th, is 6th: up 3
        [idOf(10), 1], // was and is 1st: unchanged
        [idOf(9), 1], // was 1st, is 2nd: down 1
      ]);

      it('is previous rank minus current rank: positive means moved up', async () => {
        const { service } = build({ athletes: cohort(10, 5), baseline });

        const result = await get(service, { window: 10 });

        expect(result.me?.delta).toBe(3);
        const byId = new Map(result.rows.map((r) => [r.userId, r.delta]));
        expect(byId.get(viewer.id)).toBe(3);
        expect(byId.get(idOf(10))).toBe(0);
        expect(byId.get(idOf(9))).toBe(-1);
      });

      it('is null for an athlete the baseline has no rank for, such as someone who has just joined', async () => {
        const { service } = build({ athletes: cohort(10, 5), baseline });

        const result = await get(service, { window: 10 });

        expect(result.rows.find((r) => r.userId === idOf(3))?.delta).toBeNull();
      });

      it("reads the baseline of the caller's city, metric and period, for the Monday in the city's own calendar", async () => {
        const { service, snapshots } = build({ athletes: cohort(10, 5), baseline });

        await get(service);

        // Tuesday 22 September in Cairo: the week began on Monday 21st.
        expect(snapshots.baselineRanks).toHaveBeenCalledWith(SLUG, 'activity', 'month', '2026-09-21', '2026-09-01');
      });

      it('does not read baselines for a board that is not ranked', async () => {
        const { service, snapshots } = build({ athletes: cohort(3, 2) });

        await get(service);

        expect(snapshots.baselineRanks).not.toHaveBeenCalled();
      });
    });

    it('shows name and username for everyone, and marks private profiles so the row is not opened', async () => {
      const athletes = cohort(10, 5);
      athletes[5] = { ...athletes[5]!, isPublicProfile: false };
      const { service } = build({ athletes });

      const result = await get(service, { window: 10 });

      const privateRow = result.rows.find((r) => r.userId === idOf(6));
      expect(privateRow).toMatchObject({ isPublicProfile: false, displayName: 'Athlete 6', username: 'ath6' });
      expect(result.rows.find((r) => r.userId === idOf(7))?.isPublicProfile).toBe(true);
    });

    it('falls back from display name to username to "Athlete", so a row is never nameless', async () => {
      const athletes = cohort(10, 5);
      athletes[0] = { ...athletes[0]!, displayName: null };
      athletes[1] = { ...athletes[1]!, displayName: null, username: null };
      const { service } = build({ athletes });

      const result = await get(service, { window: 10 });

      expect(result.rows.find((r) => r.userId === idOf(1))?.displayName).toBe('ath1');
      expect(result.rows.find((r) => r.userId === idOf(2))?.displayName).toBe('Athlete');
    });

    it('withholds the avatar photo of a private profile, but keeps the name, and shows the caller their own', async () => {
      // D10: a private profile is still named on the board, but the photo is what /athletes/:id
      // would never give a stranger, so it does not leave through the leaderboard either.
      const athletes = cohort(10, 5);
      athletes[5] = { ...athletes[5]!, isPublicProfile: false, avatarUrl: 'https://example.com/private.png' };
      athletes[4] = { ...athletes[4]!, isPublicProfile: false, avatarUrl: 'https://example.com/me-private.png' };
      const { service } = build({ athletes });

      const result = await get(service, { window: 10 });

      expect(result.rows.find((r) => r.userId === idOf(6))).toMatchObject({ displayName: 'Athlete 6', avatarUrl: null });
      expect(result.rows.find((r) => r.isSelf)?.avatarUrl).toBe('https://example.com/me-private.png');
    });

    it('shows the avatar photo of a public profile', async () => {
      const athletes = cohort(10, 5);
      athletes[5] = { ...athletes[5]!, isPublicProfile: true, avatarUrl: 'https://example.com/public.png' };
      const { service } = build({ athletes });

      const result = await get(service, { window: 10 });

      expect(result.rows.find((r) => r.userId === idOf(6))?.avatarUrl).toBe('https://example.com/public.png');
    });

    it('carries the avatar URL through', async () => {
      const athletes = cohort(10, 5);
      athletes[4] = { ...athletes[4]!, userId: viewer.id, avatarUrl: 'https://example.com/me.png' };
      const { service } = build({ athletes });

      expect((await get(service)).rows.find((r) => r.isSelf)?.avatarUrl).toBe('https://example.com/me.png');
    });

    it('exposes only what the contract names, never the raw totals behind a score', async () => {
      const { service } = build({ athletes: cohort(10, 5) });

      const result = await get(service);

      expect(Object.keys(result.rows[0] ?? {}).sort()).toEqual(
        ['avatarUrl', 'delta', 'displayName', 'isPublicProfile', 'isSelf', 'rank', 'score', 'userId', 'username'],
      );
    });
  });

  describe('every response satisfies the published contract', () => {
    it.each([
      ['ranked', { athletes: cohort(10, 5) }, {}],
      ['coming_soon', { athletes: [] }, { metric: 'strength' as const }],
      ['not_opted_in', { privacy: { leaderboardOptIn: false, locationForLeaderboard: false } }, {}],
      ['no_city', { privacy: { locationForLeaderboard: false } }, {}],
      ['no_eligible_sessions', { latest: null }, {}],
      ['cohort_too_small', { athletes: cohort(4, 2) }, {}],
    ])('%s', async (status, options, over) => {
      const { service } = build(options);

      const result = await get(service, over);

      expect(result.status).toBe(status);
      expect(() => leaderboardResponseSchema.parse(result)).not.toThrow();
    });
  });

  describe('the states that are not a board', () => {
    it.each(['strength', 'running', 'hyrox'] as const)('%s is coming soon, with no rows and no number', async (metric) => {
      const { service, repository } = build({ athletes: cohort(10, 5) });

      const result = await get(service, { metric });

      expect(result).toMatchObject({ status: 'coming_soon', metric, rows: [], me: null, cohortSize: 0 });
      expect(repository.cityAthletes).not.toHaveBeenCalled();
    });

    it('names the city on a coming-soon board when the athlete has one, and none when they have not', async () => {
      const withCity = await get(build().service, { metric: 'strength' });
      const without = await get(build({ latest: null }).service, { metric: 'strength' });

      expect(withCity.city).toEqual({ name: 'Alexandria', slug: SLUG });
      expect(without.city).toBeNull();
    });

    it('is not_opted_in for an athlete who has not joined, and reads nothing about the city', async () => {
      const { service, repository } = build({ privacy: { leaderboardOptIn: false, locationForLeaderboard: false } });

      const result = await get(service);

      expect(result).toMatchObject({ status: 'not_opted_in', city: null, rows: [], me: null });
      expect(repository.latestEligibleCity).not.toHaveBeenCalled();
      expect(repository.cityAthletes).not.toHaveBeenCalled();
    });

    it('is no_city for an athlete who joined but did not allow location', async () => {
      const { service, repository } = build({ privacy: { leaderboardOptIn: true, locationForLeaderboard: false } });

      const result = await get(service);

      expect(result).toMatchObject({ status: 'no_city', city: null });
      expect(repository.cityAthletes).not.toHaveBeenCalled();
    });

    it('is no_eligible_sessions for an athlete with no qualifying session anywhere', async () => {
      const { service } = build({ latest: null });

      expect(await get(service)).toMatchObject({ status: 'no_eligible_sessions', city: null, cohortSize: 0 });
    });

    it('is no_eligible_sessions, with the city and its size, when the athlete has nothing in this window', async () => {
      const { service } = build({ athletes: cohort(8, 99).map((a, i) => ({ ...a, userId: idOf(i + 1) })) });

      const result = await get(service);

      expect(result).toMatchObject({ status: 'no_eligible_sessions', city: { name: 'Alexandria' }, cohortSize: 8, rows: [], me: null });
    });

    it('withholds a small city and says how many are in it, even with the caller among them', async () => {
      const { service } = build({ athletes: cohort(4, 2) });

      const result = await get(service);

      expect(result).toMatchObject({ status: 'cohort_too_small', cohortSize: 4, rows: [], me: null, city: { name: 'Alexandria' } });
    });

    it('shows a city of exactly the minimum size', async () => {
      const { service } = build({ athletes: cohort(MIN_COHORT_SIZE, 2) });

      expect((await get(service)).status).toBe('ranked');
    });
  });

  describe('privacy is read live', () => {
    it('asks about the caller on every request and remembers nothing', async () => {
      const { service, privacyCalls } = build({ athletes: cohort(10, 5) });

      await get(service);
      await get(service);

      expect(privacyCalls).toEqual([viewer.id, viewer.id]);
    });

    it('does not consult privacy for a coming-soon metric, which shows nothing about anyone', async () => {
      const { service, privacyCalls } = build();

      await get(service, { metric: 'hyrox' });

      expect(privacyCalls).toEqual([]);
    });
  });

  describe('the window', () => {
    it("asks for the month in the CITY's timezone, not the caller's or UTC", async () => {
      const { service, repository } = build({ athletes: cohort(10, 5) });

      await get(service);

      expect(repository.cityAthletes).toHaveBeenCalledWith(SLUG, 'Africa/Cairo', {
        start: new Date('2026-08-31T21:00:00Z'),
        end: new Date('2026-09-30T21:00:00Z'),
      });
    });

    it('uses the real clock when no instant is passed', async () => {
      jest.useFakeTimers({ now: NOW });
      try {
        const { service } = build({ athletes: cohort(10, 5) });

        const result = await service.get(viewer, query());

        expect(result.periodLabel).toBe('Sep 2026');
      } finally {
        jest.useRealTimers();
      }
    });

    it('asks for everything, with no window, for all time', async () => {
      const { service, repository } = build({ athletes: cohort(10, 5) });

      const result = await get(service, { period: 'all_time' });

      expect(repository.cityAthletes).toHaveBeenCalledWith(SLUG, 'Africa/Cairo', null);
      expect(result.periodLabel).toBe('all time');
    });

    it('labels the month in the city, so 30 September 21:30 UTC reads October in Cairo', async () => {
      const { service } = build({ athletes: cohort(10, 5) });

      const result = await service.get(viewer, query(), new Date('2026-09-30T21:30:00Z'));

      expect(result.periodLabel).toBe('Oct 2026');
    });

    it('falls back to UTC, and the name on the session, for a city the list no longer has', async () => {
      const { service, repository } = build({ athletes: cohort(10, 5), city: null, latest: { citySlug: 'gone-xx-1', city: 'Old Town' } });

      const result = await get(service);

      expect(repository.cityAthletes).toHaveBeenCalledWith('gone-xx-1', 'UTC', {
        start: new Date('2026-09-01T00:00:00Z'),
        end: new Date('2026-10-01T00:00:00Z'),
      });
      expect(result.city).toEqual({ name: 'Old Town', slug: 'gone-xx-1' });
    });

    it('uses the slug as the name when neither the list nor the session has one', async () => {
      const { service } = build({ athletes: cohort(10, 5), city: null, latest: { citySlug: 'gone-xx-1', city: null } });

      expect((await get(service)).city).toEqual({ name: 'gone-xx-1', slug: 'gone-xx-1' });
    });
  });

  describe('scoring', () => {
    // Three weeks into the month, five athletes with identical, target-meeting totals: 150 minutes a
    // week and two strength days a week. Each earns the full 40 + 20 WHO points, and the identical
    // work totals put every one at the middle of the city, so 15 of the 30 work points: 75.
    const identical = (): CityAthleteRow[] =>
      Array.from({ length: 5 }, (_, i) =>
        athleteRow(i + 1, {
          userId: i === 0 ? viewer.id : idOf(i + 1),
          workingSeconds: 150 * 60 * 3,
          strengthDays: 6,
          volumeKg: 1000,
          distanceKm: 0,
        }),
      );

    it('measures the month by the weeks that have elapsed, so meeting the weekly targets scores full WHO marks', async () => {
      const { service } = build({ athletes: identical() });

      expect((await get(service)).me?.score).toBe(75);
    });

    it('measures all time by each athlete\'s own weeks since their first session', async () => {
      const athletes = identical().map((a) => ({ ...a, firstStartedAt: new Date('2026-08-31T21:00:00Z') }));
      const { service } = build({ athletes });

      // Exactly 3 weeks since that first session, the same as the month above.
      expect((await get(service, { period: 'all_time' })).me?.score).toBe(75);
    });

    it('lets someone who trained more outrank someone who trained less', async () => {
      const { service } = build({ athletes: cohort(10, 3) });

      const result = await get(service, { window: 10 });

      const scores = result.rows.map((r) => r.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });
  });
});
