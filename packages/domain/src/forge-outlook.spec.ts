import { FORGE_HOLD_WEEKS, ForgeLadderState, initialForgeState } from './forge-evaluation';
import { forgeWeekOutlook } from './forge-outlook';
import { firstLevelOf, maxLevelOf, targetOf, topLevelOf } from './forge-tiers';

const state = (overrides: Partial<ForgeLadderState> = {}): ForgeLadderState => ({
  ...initialForgeState(),
  ...overrides,
});

describe('forgeWeekOutlook (what the open week does if it closed now)', () => {
  it('says a week short of its goal would miss, and names the total that would hit it', () => {
    const outlook = forgeWeekOutlook('volume', state({ level: 4, bestLevel: 4 }), 1000);

    expect(outlook.result.outcome).toBe('miss');
    expect(outlook.result.levelAfter).toBe(4);
    expect(outlook.nextStep).toEqual({ total: targetOf('volume', 4), levelAfter: 5 });
  });

  it('says a met goal climbs one level, and names the total for the next jump', () => {
    // Level 4 (5 500 kg) with 6 250 kg logged: level 5 on Saturday; 10 000 kg (level 6's goal) jumps.
    const outlook = forgeWeekOutlook('volume', state({ level: 4, bestLevel: 4 }), 6250);

    expect(outlook.result.outcome).toBe('hit');
    expect(outlook.result.levelAfter).toBe(5);
    expect(outlook.nextStep).toEqual({ total: 10_000, levelAfter: 6 });
  });

  it('has no next step once the week already climbs the most a week can', () => {
    const outlook = forgeWeekOutlook('volume', state(), 1e6);

    expect(outlook.result.levelAfter).toBe(4);
    expect(outlook.nextStep).toBeNull();
  });

  it('at the top of a ladder, names the goal that keeps the level, then nothing once it is met', () => {
    const top = maxLevelOf('nourish');
    const at = state({ level: top, bestLevel: top });

    expect(forgeWeekOutlook('nourish', at, 0).nextStep).toEqual({ total: 6, levelAfter: top });
    expect(forgeWeekOutlook('nourish', at, 6).nextStep).toBeNull();
  });

  it('never promises Forged before the Tempered hold is complete', () => {
    const temperedTop = topLevelOf('volume', 'tempered')!;
    const at = state({ level: temperedTop, bestLevel: temperedTop, temperedHoldWeeks: 1 });

    const outlook = forgeWeekOutlook('volume', at, 1e6);

    expect(outlook.result.levelAfter).toBe(temperedTop);
    expect(outlook.nextStep).toBeNull();
  });

  it('names the goal that opens Forged once the hold is complete', () => {
    const temperedTop = topLevelOf('volume', 'tempered')!;
    const at = state({ level: temperedTop, bestLevel: temperedTop, temperedHoldWeeks: FORGE_HOLD_WEEKS });

    const outlook = forgeWeekOutlook('volume', at, 0);

    expect(outlook.nextStep).toEqual({ total: targetOf('volume', temperedTop), levelAfter: temperedTop + 1 });
  });

  it('says a Forged athlete short of the goal would cool, and names the total that keeps Forged', () => {
    const forged = firstLevelOf('consistency', 'forged')!;
    const at = state({ level: forged, bestLevel: forged, forgedStreak: 2, bestForgedStreak: 2 });

    const outlook = forgeWeekOutlook('consistency', at, 1);

    expect(outlook.result.outcome).toBe('cooled');
    expect(outlook.nextStep).toEqual({ total: 6, levelAfter: forged });
  });

  it('says the third miss in a row would drop a level, and names the goal that avoids it', () => {
    const outlook = forgeWeekOutlook('distance', state({ level: 5, bestLevel: 5, missStreak: 2 }), 0);

    expect(outlook.result.outcome).toBe('drop');
    expect(outlook.result.levelAfter).toBe(4);
    expect(outlook.nextStep).toEqual({ total: targetOf('distance', 5), levelAfter: 6 });
  });
});
