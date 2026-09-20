import { rankCity, buildActivityInputs } from './activity-inputs';
import type { CityAthleteRow } from './leaderboards.repository';

const NOW = new Date('2026-09-20T12:00:00Z');
const MONTH = { start: new Date('2026-08-31T21:00:00Z'), end: new Date('2026-09-30T21:00:00Z') };

const athlete = (userId: string, over: Partial<CityAthleteRow> = {}): CityAthleteRow => ({
  userId,
  firstStartedAt: new Date('2026-09-02T10:00:00Z'),
  workingSeconds: 3600,
  volumeKg: 1000,
  distanceKm: 0,
  strengthDays: 2,
  displayName: null,
  username: null,
  avatarUrl: null,
  isPublicProfile: false,
  ...over,
});

describe('buildActivityInputs', () => {
  it('converts seconds to minutes and carries every total and the first start', () => {
    const [input] = buildActivityInputs([athlete('a', { workingSeconds: 5400, volumeKg: 4608, distanceKm: 12.5 })], MONTH, NOW);

    expect(input).toMatchObject({
      userId: 'a',
      workingMinutes: 90,
      volumeKg: 4608,
      distanceKm: 12.5,
      strengthDays: 2,
      firstStartedAtMs: new Date('2026-09-02T10:00:00Z').getTime(),
    });
  });

  it('scores a month over the month, the same length for everyone', () => {
    const inputs = buildActivityInputs([athlete('a'), athlete('b', { firstStartedAt: new Date('2026-09-15T10:00:00Z') })], MONTH, NOW);

    expect(inputs[0]?.weeks).toBe(inputs[1]?.weeks);
  });

  it('scores all time over each athlete\'s own time since their first session', () => {
    const inputs = buildActivityInputs(
      [athlete('early', { firstStartedAt: new Date('2026-01-05T10:00:00Z') }), athlete('late', { firstStartedAt: new Date('2026-09-14T10:00:00Z') })],
      null,
      NOW,
    );

    expect(inputs[0]?.weeks).toBeGreaterThan(inputs[1]?.weeks as number);
  });

  it('does not modify the rows it is given', () => {
    const rows = [athlete('a')];
    const copy = JSON.stringify(rows);
    buildActivityInputs(rows, MONTH, NOW);
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe('rankCity', () => {
  it('ranks best first with contiguous ranks', () => {
    const ranked = rankCity(
      [athlete('low', { workingSeconds: 600, volumeKg: 100, strengthDays: 0 }), athlete('high', { workingSeconds: 9000, volumeKg: 9000, strengthDays: 4 })],
      MONTH,
      NOW,
    );

    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ['high', 1],
      ['low', 2],
    ]);
  });

  it('is empty for an empty city', () => {
    expect(rankCity([], MONTH, NOW)).toEqual([]);
  });
});
