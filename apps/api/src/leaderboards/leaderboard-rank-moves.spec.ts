import type { CityAthleteRow, LeaderboardsRepository } from './leaderboards.repository';
import type { LeaderboardSnapshotRepository } from './leaderboard-snapshot.repository';
import { LeaderboardSnapshotService, type RankMoveSink } from './leaderboard-snapshot.service';
import type { CityResolverService } from '../cities/city-resolver.service';

// Phase 12F slice 6 (docs/product/phase-12f-plan.md). The weekly snapshot already has the standings from the week before; when
// it computes the new ones, anyone whose rank changed on the all-time board is handed to the push queue (not the month board,
// which resets). Boards below the minimum have no standings, so no one is told anything. The snapshot never depends on this.
const NOW = new Date('2026-09-19T00:20:00Z'); // Saturday
const athlete = (n: number): CityAthleteRow => ({
  userId: `user-${n}`,
  firstStartedAt: new Date('2026-09-01T10:00:00Z'),
  workingSeconds: 1800 * n,
  volumeKg: 500 * n,
  distanceKm: 0,
  strengthDays: Math.min(n, 4),
  displayName: null,
  username: null,
  avatarUrl: null,
  isPublicProfile: true,
});
const city = (count: number) => Array.from({ length: count }, (_, i) => athlete(i + 1));

describe('LeaderboardSnapshotService rank moves', () => {
  let leaderboards: { cityAthletes: jest.Mock };
  let snapshots: { eligibleCities: jest.Mock; replaceWeek: jest.Mock; baselineRanks: jest.Mock };
  let resolver: { findBySlug: jest.Mock };
  let sink: { queue: jest.Mock };
  let service: LeaderboardSnapshotService;

  beforeEach(() => {
    leaderboards = { cityAthletes: jest.fn().mockResolvedValue(city(6)) };
    snapshots = {
      eligibleCities: jest.fn().mockResolvedValue(['cairo']),
      replaceWeek: jest.fn().mockResolvedValue(undefined),
      // Last Saturday user-5 was first and user-6 second; now user-6 leads.
      baselineRanks: jest.fn().mockResolvedValue(new Map([['user-5', 1], ['user-6', 2], ['user-4', 3]])),
    };
    resolver = { findBySlug: jest.fn().mockReturnValue({ name: 'Cairo', timezone: 'Africa/Cairo' }) };
    sink = { queue: jest.fn().mockResolvedValue(true) };
    service = new LeaderboardSnapshotService(
      leaderboards as unknown as LeaderboardsRepository,
      snapshots as unknown as LeaderboardSnapshotRepository,
      resolver as unknown as CityResolverService,
      sink as RankMoveSink,
    );
  });

  it('reads last Saturday\'s all-time standings before replacing the week, and queues a push for each mover', async () => {
    const summary = await service.captureAll(NOW);

    expect(snapshots.baselineRanks).toHaveBeenCalledTimes(1);
    expect(snapshots.baselineRanks).toHaveBeenCalledWith('cairo', 'activity', 'all_time', '2026-09-12', '2026-09-12');
    const allTimeReplace = snapshots.replaceWeek.mock.invocationCallOrder[1] as number;
    expect(snapshots.baselineRanks.mock.invocationCallOrder[0] as number).toBeLessThan(allTimeReplace);
    expect(sink.queue.mock.calls.map(([move]) => [move.userId, move.direction])).toEqual([
      ['user-6', 'up'],
      ['user-5', 'down'],
    ]);
    expect(sink.queue).toHaveBeenCalledWith(
      expect.objectContaining({ cityName: 'Cairo', weekStart: '2026-09-19', occurredAt: NOW }),
    );
    expect(summary).toMatchObject({ moves: 2, moveFailures: 0 });
  });

  it('queues nothing without earlier standings, or when the board is too small to show', async () => {
    snapshots.baselineRanks.mockResolvedValue(new Map());
    await service.captureAll(NOW);
    expect(sink.queue).not.toHaveBeenCalled();

    leaderboards.cityAthletes.mockResolvedValue(city(3));
    snapshots.baselineRanks.mockResolvedValue(new Map([['user-1', 2]]));
    await service.captureAll(NOW);
    expect(sink.queue).not.toHaveBeenCalled();
  });

  it('skips a city whose name is unknown, and carries on when queueing fails, without failing the snapshot', async () => {
    sink.queue.mockRejectedValueOnce(new Error('db down'));

    const summary = await service.captureAll(NOW);

    expect(sink.queue).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ cities: 1, failures: [], moves: 1, moveFailures: 1 });

    resolver.findBySlug.mockReturnValue({ timezone: 'UTC' });
    sink.queue.mockClear();
    await service.captureAll(NOW);
    expect(sink.queue).not.toHaveBeenCalled();
  });

  it('counts only the pushes that were really queued', async () => {
    sink.queue.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(service.captureAll(NOW)).resolves.toMatchObject({ moves: 1, moveFailures: 0 });
  });

  it('counts a failed baseline read as a failed push step without failing the snapshot', async () => {
    snapshots.baselineRanks.mockRejectedValue(new Error('db down'));

    const summary = await service.captureAll(NOW);

    expect(summary).toMatchObject({ cities: 1, failures: [], moves: 0, moveFailures: 1 });
    expect(sink.queue).not.toHaveBeenCalled();
  });

  it('tells no one on a mid-week run, which carries last Saturday' + String.fromCharCode(39) + 's label', async () => {
    await service.captureAll(new Date('2026-09-23T10:00:00Z')); // Wednesday

    expect(snapshots.baselineRanks).not.toHaveBeenCalled();
    expect(sink.queue).not.toHaveBeenCalled();
    expect(snapshots.replaceWeek).toHaveBeenCalled();
  });

  it('behaves as before when there is no sink', async () => {
    const plain = new LeaderboardSnapshotService(
      leaderboards as unknown as LeaderboardsRepository,
      snapshots as unknown as LeaderboardSnapshotRepository,
      resolver as unknown as CityResolverService,
    );

    const summary = await plain.captureAll(NOW);

    expect(snapshots.baselineRanks).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ cities: 1, moves: 0, moveFailures: 0 });
  });
});
