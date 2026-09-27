// The words Weekly Forge uses for a closed week, as approved in the Phase 7 mock-ups (items D, G
// and H): the summary's title, each ladder's result label and detail, and the level-up toast.
// Everything is derived from the server's week summary; nothing here reads the clock.
import type { ForgeWeekSummary } from '@forjd/contracts';

import { outcomeChip, outcomeDetail, toastLine, weekRangeLabel } from '../forge-copy';

type LadderWeek = ForgeWeekSummary['ladders'][number];

const week = (over: Partial<LadderWeek>): LadderWeek => ({
  ladder: 'volume',
  outcome: 'hit',
  levelBefore: 6,
  levelAfter: 7,
  bandBefore: 'ore',
  bandAfter: 'ember',
  total: 5100,
  target: 5000,
  celebration: 'band',
  rewards: [],
  ...over,
});

describe('weekRangeLabel', () => {
  it('names the Saturday-to-Friday week', () => {
    expect(weekRangeLabel('2026-09-19')).toBe('19 – 25 Sep');
  });

  it('names both months when the week crosses one', () => {
    expect(weekRangeLabel('2026-09-26')).toBe('26 Sep – 2 Oct');
    expect(weekRangeLabel('2026-12-26')).toBe('26 Dec – 1 Jan');
  });
});

describe('outcomeChip', () => {
  it('labels each result the approved way', () => {
    expect(
      outcomeChip(week({ celebration: 'level', bandBefore: 'ember', bandAfter: 'ember', levelBefore: 3, levelAfter: 4 })),
    ).toEqual({ label: 'Level 3 → 4', tone: 'up' });
    expect(
      outcomeChip(
        week({ outcome: 'overshoot', celebration: 'level', bandBefore: 'ember', bandAfter: 'ember', levelBefore: 7, levelAfter: 9 }),
      ),
    ).toEqual({ label: '+2 levels', tone: 'up' });
    expect(outcomeChip(week({}))).toEqual({ label: 'New band', tone: 'band' });
    expect(outcomeChip(week({ outcome: 'miss', celebration: 'none', levelAfter: 6, bandAfter: 'ore' }))).toEqual({
      label: 'Held',
      tone: 'hold',
    });
    expect(
      outcomeChip(
        week({ outcome: 'drop', celebration: 'none', levelBefore: 9, levelAfter: 8, bandBefore: 'ember', bandAfter: 'ember' }),
      ),
    ).toEqual({ label: 'Eased to 8', tone: 'hold' });
    expect(
      outcomeChip(week({ outcome: 'cooled', celebration: 'cooled', bandBefore: 'forged', bandAfter: 'tempered' })),
    ).toEqual({ label: 'Cooled', tone: 'hold' });
  });

  it('says "Target met" when the target was met at the top level, where there is nowhere higher to go', () => {
    expect(
      outcomeChip(
        week({ ladder: 'consistency', celebration: 'none', levelBefore: 6, levelAfter: 6, bandBefore: 'forged', bandAfter: 'forged' }),
      ),
    ).toEqual({ label: 'Target met', tone: 'up' });
  });

  it('never calls a Nourish band "New band", because Nourish stays calm', () => {
    expect(
      outcomeChip(
        week({ ladder: 'nourish', celebration: 'level', levelBefore: 2, levelAfter: 3, bandBefore: 'ore', bandAfter: 'ember' }),
      ),
    ).toEqual({ label: 'Level 2 → 3', tone: 'up' });
  });
});

describe('outcomeDetail', () => {
  it('gives the total against the target and the level change', () => {
    expect(outcomeDetail(week({}), 'kg')).toBe('5,100 of 5,000 kg · level 6 → 7');
  });

  it('says the level was kept after a short week', () => {
    expect(
      outcomeDetail(week({ ladder: 'distance', outcome: 'miss', total: 6.2, target: 11, levelBefore: 5, levelAfter: 5 }), 'km'),
    ).toBe('6.2 of 11 km · stays at level 5');
  });

  it('gives the lighter target after easing down', () => {
    expect(
      outcomeDetail(week({ ladder: 'minutes', outcome: 'drop', total: 150, target: 230, levelBefore: 6, levelAfter: 5 }), 'minutes'),
    ).toBe('150 of 230 min · next target 190 min');
  });

  it('still reads sensibly, rather than crashing Home, if a level is outside the table', () => {
    expect(outcomeDetail(week({ ladder: 'nourish', outcome: 'drop', total: 1, target: 6, levelBefore: 9, levelAfter: 8 }), 'days')).toBe(
      '1 of 6 days · eased to level 8',
    );
  });

  it('uses the agreed line for cooling', () => {
    expect(outcomeDetail(week({ outcome: 'cooled' }), 'kg')).toBe('Cooled to Tempered. Hold 4 weeks to re-forge.');
  });
});

describe('toastLine', () => {
  it('strikes a level-up', () => {
    expect(
      toastLine(week({ celebration: 'level', levelBefore: 7, levelAfter: 8, bandBefore: 'ember', bandAfter: 'ember' })),
    ).toBe('Struck. Volume rose to level 8.');
  });

  it('names a bigger climb', () => {
    expect(
      toastLine(
        week({
          ladder: 'distance',
          outcome: 'overshoot',
          celebration: 'level',
          levelBefore: 4,
          levelAfter: 6,
          bandBefore: 'ore',
          bandAfter: 'ore',
        }),
      ),
    ).toBe('Struck. Distance climbed 2 levels to level 6.');
  });

  it('keeps Nourish plain, with no flavour line', () => {
    expect(
      toastLine(week({ ladder: 'nourish', celebration: 'level', levelBefore: 2, levelAfter: 3, bandBefore: 'ore', bandAfter: 'ember' })),
    ).toBe('Nourish reached Ember.');
    expect(
      toastLine(
        week({ ladder: 'nourish', celebration: 'level', levelBefore: 3, levelAfter: 4, bandBefore: 'ember', bandAfter: 'ember' }),
      ),
    ).toBe('Nourish rose to level 4.');
  });
});

// The plan's rule for this feature's copy: never shaming. Every line a closed week can produce,
// for every outcome, is checked against words that blame, scold or dramatise a short week.
describe('no shaming words', () => {
  const BANNED = /\b(fail\w*|lost|lose|losing|bad|lazy|missed|miss|behind|shame\w*|weak\w*|quit\w*|broke\w*|slack\w*|ruin\w*|penalt\w*)\b/i;
  const outcomes: LadderWeek['outcome'][] = ['hit', 'overshoot', 'miss', 'drop', 'cooled'];

  it.each(outcomes)('keeps every %s line calm', (outcome) => {
    for (const ladder of ['volume', 'nourish'] as const) {
      const w = week({ ladder, outcome, levelBefore: 5, levelAfter: outcome === 'drop' ? 4 : 5 });
      for (const line of [outcomeChip(w).label, outcomeDetail(w, 'kg'), toastLine(w)]) {
        expect(line).not.toMatch(BANNED);
      }
    }
  });
});
