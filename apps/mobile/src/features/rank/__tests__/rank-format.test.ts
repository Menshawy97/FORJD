import {
  RANK_CHIPS,
  RANK_PERIODS,
  deltaView,
  formatScore,
  listHeading,
  metricLabel,
  rowName,
  weekLine,
} from '../rank-format';

describe('deltaView', () => {
  it('draws an up arrow and the number for a rise', () => {
    expect(deltaView(2)).toEqual({ text: '↑2', tone: 'up' });
  });

  it('draws a down arrow and the size of the fall, without a minus sign', () => {
    expect(deltaView(-1)).toEqual({ text: '↓1', tone: 'down' });
  });

  it('draws a dash for no movement', () => {
    expect(deltaView(0)).toEqual({ text: '—', tone: 'flat' });
  });

  it('draws nothing when there is no baseline, so a missing figure is not read as "no change"', () => {
    expect(deltaView(null)).toBeNull();
  });
});

describe('weekLine', () => {
  it('spells out a rise, a fall and no change', () => {
    expect(weekLine(3)).toEqual({ text: '↑ 3 this week', tone: 'up' });
    expect(weekLine(-2)).toEqual({ text: '↓ 2 this week', tone: 'down' });
    expect(weekLine(0)).toEqual({ text: 'No change this week', tone: 'flat' });
  });

  it('is absent when there is nothing to compare', () => {
    expect(weekLine(null)).toBeNull();
  });
});

describe('formatScore', () => {
  it('always shows one decimal', () => {
    expect(formatScore(92.7)).toBe('92.7');
    expect(formatScore(90)).toBe('90.0');
    expect(formatScore(0)).toBe('0.0');
  });
});

describe('labels', () => {
  it('offers the four metrics in the design order and both periods', () => {
    expect(RANK_CHIPS.map((c) => c.label)).toEqual(['Activity', 'Strength', 'Running', 'HYROX']);
    expect(RANK_PERIODS.map((p) => p.label)).toEqual(['This Month', 'All Time']);
  });

  it('names a metric by its chip', () => {
    expect(metricLabel('hyrox')).toBe('HYROX');
  });

  it('builds the list heading from the server window text', () => {
    expect(listHeading('activity', 'Sep 2026')).toBe('Activity score — Sep 2026');
    expect(listHeading('activity', 'all time')).toBe('Activity score — all time');
  });

  it("marks the caller's own row", () => {
    expect(rowName({ displayName: 'James M.', isSelf: true })).toBe('James M. (you)');
    expect(rowName({ displayName: 'Karim A.', isSelf: false })).toBe('Karim A.');
  });
});
