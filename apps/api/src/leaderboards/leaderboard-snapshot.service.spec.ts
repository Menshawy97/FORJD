import { MIN_COHORT_SIZE } from '@forjd/domain';

import { CityAthleteRow, LeaderboardsRepository } from './leaderboards.repository';
import { LeaderboardSnapshotRepository } from './leaderboard-snapshot.repository';
import { LeaderboardSnapshotService } from './leaderboard-snapshot.service';
import { CityResolverService } from '../cities/city-resolver.service';

// Saturday 00:20 UTC, when the job runs (weeks start on Saturday, ADR-056).
const NOW = new Date('2026-09-19T00:20:00Z');

const athlete = (n: number): CityAthleteRow => ({
  userId: `user-${n}`,
  firstStartedAt: new Date('2026-09-01T10:00:00Z'),
  // Athlete n trains more than athlete n-1, so the order is strict: the highest n is first.
  workingSeconds: 1800 * n,
  volumeKg: 500 * n,
  distanceKm: 0,
  strengthDays: Math.min(n, 4),
  displayName: null,
  username: null,
  avatarUrl: null,
  isPublicProfile: true,
});

const city = (count: number): CityAthleteRow[] => Array.from({ length: count }, (_, i) => athlete(i + 1));

describe('LeaderboardSnapshotService', () => {
  let leaderboards: jest.Mocked<Pick<LeaderboardsRepository, 'cityAthletes'>>;
  let snapshots: jest.Mocked<Pick<LeaderboardSnapshotRepository, 'eligibleCities' | 'replaceWeek'>>;
  let resolver: jest.Mocked<Pick<CityResolverService, 'findBySlug'>>;
  let service: LeaderboardSnapshotService;

  beforeEach(() => {
    leaderboards = { cityAthletes: jest.fn() };
    snapshots = { eligibleCities: jest.fn(), replaceWeek: jest.fn().mockResolvedValue(undefined) };
    resolver = { findBySlug: jest.fn().mockReturnValue({ timezone: 'Africa/Cairo' }) };
    service = new LeaderboardSnapshotService(
      leaderboards as unknown as LeaderboardsRepository,
      snapshots as unknown as LeaderboardSnapshotRepository,
      resolver as unknown as CityResolverService,
    );
  });

  it('asks for the cities that have a board, using the minimum cohort size', async () => {
    snapshots.eligibleCities.mockResolvedValue([]);

    await service.captureAll(NOW);

    expect(snapshots.eligibleCities).toHaveBeenCalledWith(MIN_COHORT_SIZE);
  });

  it('records the rank and score of everyone in a city, for the month and for all time', async () => {
    snapshots.eligibleCities.mockResolvedValue(['cairo-eg-360630']);
    leaderboards.cityAthletes.mockResolvedValue(city(6));

    const summary = await service.captureAll(NOW);

    expect(snapshots.replaceWeek).toHaveBeenCalledTimes(2);
    const calls = snapshots.replaceWeek.mock.calls;
    expect(calls.map((c) => [c[0], c[1], c[2], c[3]])).toEqual([
      ['cairo-eg-360630', 'activity', 'month', '2026-09-19'],
      ['cairo-eg-360630', 'activity', 'all_time', '2026-09-19'],
    ]);
    const monthRows = calls[0]?.[4] ?? [];
    expect(monthRows).toHaveLength(6);
    expect(monthRows[0]).toMatchObject({ userId: 'user-6', rank: 1, cohortSize: 6 });
    expect(monthRows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(summary).toEqual({ cities: 1, rows: 12, failures: [] });
  });

  it('measures the month in the city\'s own calendar', async () => {
    snapshots.eligibleCities.mockResolvedValue(['cairo-eg-360630']);
    leaderboards.cityAthletes.mockResolvedValue(city(5));

    await service.captureAll(NOW);

    const [, zone, monthWindow] = leaderboards.cityAthletes.mock.calls[0] ?? [];
    expect(zone).toBe('Africa/Cairo');
    expect(monthWindow).toEqual({ start: new Date('2026-08-31T21:00:00Z'), end: new Date('2026-09-30T21:00:00Z') });
    expect(leaderboards.cityAthletes.mock.calls[1]?.[2]).toBeNull();
  });

  it('labels each city with the Saturday of its own week', async () => {
    snapshots.eligibleCities.mockResolvedValue(['nyc-us-1']);
    resolver.findBySlug.mockReturnValue({ timezone: 'America/New_York' } as never);
    leaderboards.cityAthletes.mockResolvedValue(city(5));

    await service.captureAll(NOW); // Friday evening in New York

    expect(snapshots.replaceWeek.mock.calls[0]?.[3]).toBe('2026-09-19');
  });

  it('falls back to UTC for a city missing from the current dataset', async () => {
    snapshots.eligibleCities.mockResolvedValue(['old-city']);
    resolver.findBySlug.mockReturnValue(null);
    leaderboards.cityAthletes.mockResolvedValue(city(5));

    await service.captureAll(NOW);

    expect(leaderboards.cityAthletes.mock.calls[0]?.[1]).toBe('UTC');
  });

  it('clears the week rather than storing a board too small to show, for a period below the minimum', async () => {
    snapshots.eligibleCities.mockResolvedValue(['cairo-eg-360630']);
    leaderboards.cityAthletes.mockResolvedValueOnce(city(MIN_COHORT_SIZE - 1)).mockResolvedValueOnce(city(6));

    const summary = await service.captureAll(NOW);

    expect(snapshots.replaceWeek.mock.calls[0]?.[2]).toBe('month');
    expect(snapshots.replaceWeek.mock.calls[0]?.[4]).toEqual([]);
    expect(snapshots.replaceWeek.mock.calls[1]?.[4]).toHaveLength(6);
    expect(summary.rows).toBe(6);
  });

  it('carries on after one city fails and reports it, so one bad city cannot stop the rest', async () => {
    snapshots.eligibleCities.mockResolvedValue(['bad', 'good']);
    leaderboards.cityAthletes.mockImplementation(async (slug: string) => {
      if (slug === 'bad') throw new Error('boom');
      return city(5);
    });

    const summary = await service.captureAll(NOW);

    expect(summary.cities).toBe(1);
    expect(summary.failures).toEqual([{ citySlug: 'bad', message: 'boom' }]);
    expect(snapshots.replaceWeek).toHaveBeenCalledTimes(2);
  });

  it('reports a non-Error failure by its text', async () => {
    snapshots.eligibleCities.mockResolvedValue(['bad']);
    leaderboards.cityAthletes.mockRejectedValue('plain string');

    const summary = await service.captureAll(NOW);

    expect(summary.failures).toEqual([{ citySlug: 'bad', message: 'plain string' }]);
  });

  it('captures several cities at once, never more than four in flight (review 8.5, L9a-8)', async () => {
    const slugs = Array.from({ length: 10 }, (_, i) => `city-${i}`);
    snapshots.eligibleCities.mockResolvedValue(slugs);
    let inFlight = 0;
    let peak = 0;
    leaderboards.cityAthletes.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return city(5);
    });

    const summary = await service.captureAll(NOW);

    expect(peak).toBe(4);
    expect(summary).toEqual({ cities: 10, rows: 100, failures: [] });
    expect(new Set(snapshots.replaceWeek.mock.calls.map((c) => c[0]))).toEqual(new Set(slugs));
  });

  it('does nothing when no city has a board', async () => {
    snapshots.eligibleCities.mockResolvedValue([]);

    await expect(service.captureAll(NOW)).resolves.toEqual({ cities: 0, rows: 0, failures: [] });
    expect(leaderboards.cityAthletes).not.toHaveBeenCalled();
  });
});
