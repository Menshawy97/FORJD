import { celebrationFor, LadderWeekChange, summariseWeek } from './forge-celebration';

const change = (overrides: Partial<LadderWeekChange> = {}): LadderWeekChange => ({
  ladder: 'volume',
  outcome: 'miss',
  levelBefore: 3,
  levelAfter: 3,
  bandBefore: 'ore',
  bandAfter: 'ore',
  rewards: [],
  ...overrides,
});

const levelUp = (ladder: LadderWeekChange['ladder'] = 'volume') =>
  change({
    ladder,
    outcome: 'hit',
    levelAfter: 4,
    rewards: [{ type: 'forge_mark', level: 4, band: 'ore' }],
  });

const bandUp = (ladder: LadderWeekChange['ladder'] = 'volume') =>
  change({
    ladder,
    outcome: 'hit',
    levelBefore: 6,
    levelAfter: 7,
    bandAfter: 'ember',
    rewards: [
      { type: 'forge_mark', level: 7, band: 'ember' },
      { type: 'band_badge', level: 7, band: 'ember' },
    ],
  });

const forgedUp = change({
  ladder: 'consistency',
  outcome: 'hit',
  levelBefore: 5,
  levelAfter: 6,
  bandBefore: 'tempered',
  bandAfter: 'forged',
  rewards: [{ type: 'forged', level: 6, band: 'forged' }],
});

const cooled = change({
  ladder: 'distance',
  outcome: 'cooled',
  levelBefore: 28,
  levelAfter: 27,
  bandBefore: 'forged',
  bandAfter: 'tempered',
});

describe('celebrationFor (one ladder)', () => {
  it('is nothing for a missed or held week: no celebration, no shame', () => {
    expect(celebrationFor(change())).toBe('none');
    expect(celebrationFor(change({ outcome: 'drop', levelAfter: 2 }))).toBe('none');
    expect(celebrationFor(change({ outcome: 'hit' }))).toBe('none');
  });

  it('is a level-up for a new level inside the band', () => {
    expect(celebrationFor(levelUp())).toBe('level');
  });

  it('is a band crossing when a band badge was earned', () => {
    expect(celebrationFor(bandUp())).toBe('band');
  });

  it('is only a level-up for re-entering a band already reached before (no new badge)', () => {
    const reEntry = change({ outcome: 'hit', levelBefore: 6, levelAfter: 7, bandAfter: 'ember' });
    expect(celebrationFor(reEntry)).toBe('level');
  });

  it('is Forged when the athlete enters Forged, first time or re-forge', () => {
    expect(celebrationFor(forgedUp)).toBe('forged');
  });

  it('is the gentle cooled state when Forged is lost', () => {
    expect(celebrationFor(cooled)).toBe('cooled');
  });

  it('keeps Nourish calm: a band crossing there is only ever a level-up', () => {
    expect(celebrationFor(bandUp('nourish'))).toBe('level');
  });
});

describe('summariseWeek (every ladder at once)', () => {
  it('plays the single biggest celebration of the week', () => {
    const summary = summariseWeek([levelUp('distance'), bandUp('volume'), change({ ladder: 'minutes' })]);

    expect(summary.biggest).toBe('band');
    expect(summary.biggestLadder).toBe('volume');
  });

  it('ranks Forged above a band, a band above a level, and a level above cooling', () => {
    expect(summariseWeek([cooled, levelUp(), bandUp(), forgedUp]).biggest).toBe('forged');
    expect(summariseWeek([cooled, levelUp()]).biggest).toBe('level');
    expect(summariseWeek([cooled, change()]).biggest).toBe('cooled');
  });

  it('is none for a week with nothing to celebrate', () => {
    const summary = summariseWeek([change(), change({ ladder: 'nourish' })]);

    expect(summary.biggest).toBe('none');
    expect(summary.biggestLadder).toBeNull();
  });

  it('never offers Share for a Nourish-led celebration', () => {
    expect(summariseWeek([bandUp('volume')]).shareable).toBe(true);
    expect(summariseWeek([levelUp('nourish')]).shareable).toBe(false);
  });

  it('only offers Share for a band crossing or Forged', () => {
    expect(summariseWeek([levelUp()]).shareable).toBe(false);
    expect(summariseWeek([forgedUp]).shareable).toBe(true);
    expect(summariseWeek([cooled]).shareable).toBe(false);
  });

  it("counts the week's levels gained and marks earned across every ladder", () => {
    const summary = summariseWeek([levelUp('distance'), bandUp('volume'), cooled]);

    expect(summary.levelsGained).toBe(2);
    expect(summary.marksEarned).toBe(2);
    expect(summary.perLadder.map((item) => item.celebration)).toEqual(['level', 'band', 'cooled']);
  });
});
