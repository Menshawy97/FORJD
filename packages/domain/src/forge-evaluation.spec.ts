import {
  evaluateWeek,
  FORGE_HOLD_WEEKS,
  FORGE_MAX_CLIMB,
  FORGE_MISSES_BEFORE_DROP,
  ForgeLadderState,
  ForgeWeekResult,
  initialForgeState,
} from './forge-evaluation';
import { FORGE_LADDERS, ForgeLadder } from './forge-vocabulary';
import { firstLevelOf, maxLevelOf, targetOf, topLevelOf } from './forge-tiers';

const state = (overrides: Partial<ForgeLadderState> = {}): ForgeLadderState => ({
  ...initialForgeState(),
  ...overrides,
});

/** Folds a run of weekly totals, the way the evaluation job does, and returns every result. */
function run(ladder: ForgeLadder, totals: number[], start = initialForgeState()): ForgeWeekResult[] {
  const results: ForgeWeekResult[] = [];
  let current = start;
  for (const total of totals) {
    const result = evaluateWeek(ladder, current, total);
    results.push(result);
    current = result.next;
  }
  return results;
}

const last = <T>(items: T[]): T => items[items.length - 1]!;

describe('the rule constants', () => {
  it('are the ones the user accepted (ADR-057)', () => {
    expect(FORGE_MAX_CLIMB).toBe(3);
    expect(FORGE_MISSES_BEFORE_DROP).toBe(3);
    expect(FORGE_HOLD_WEEKS).toBe(4);
  });
});

describe('initialForgeState', () => {
  it('starts every ladder at Ore 1 with no streaks (no backfill from history)', () => {
    expect(initialForgeState()).toEqual({
      level: 1,
      bestLevel: 1,
      missStreak: 0,
      temperedHoldWeeks: 0,
      forgedStreak: 0,
      bestForgedStreak: 0,
    });
  });
});

describe('hitting the target', () => {
  it('moves up exactly one level when the total meets the target', () => {
    const result = evaluateWeek('volume', state(), targetOf('volume', 1));

    expect(result.outcome).toBe('hit');
    expect(result.target).toBe(2000);
    expect(result.levelBefore).toBe(1);
    expect(result.levelAfter).toBe(2);
    expect(result.next.level).toBe(2);
  });

  it('moves up one level when the total clears this target but not the next', () => {
    const result = evaluateWeek('volume', state(), 2499);

    expect(result.outcome).toBe('hit');
    expect(result.levelAfter).toBe(2);
  });

  it('clears the miss streak', () => {
    const result = evaluateWeek('volume', state({ missStreak: 2 }), 2000);

    expect(result.next.missStreak).toBe(0);
  });
});

describe('overshooting', () => {
  it('moves to the highest level the total clears', () => {
    // Level 1 (2 000 kg); 3 000 clears level 3's target, so the athlete lands on level 3.
    const result = evaluateWeek('volume', state(), 3000);

    expect(result.outcome).toBe('overshoot');
    expect(result.levelAfter).toBe(3);
  });

  it('climbs +3 at most in one week', () => {
    // 50 000 kg clears level 26, but a week moves three levels at most.
    const result = evaluateWeek('volume', state(), 50_000);

    expect(result.outcome).toBe('overshoot');
    expect(result.levelAfter).toBe(1 + FORGE_MAX_CLIMB);
  });

  it('never climbs past the top of the ladder', () => {
    const top = maxLevelOf('nourish');
    const result = evaluateWeek('nourish', state({ level: top - 1, bestLevel: top - 1 }), 7);

    expect(result.levelAfter).toBe(top);
  });

  it('holds at the top level when the athlete hits it again', () => {
    const top = maxLevelOf('nourish');
    const result = evaluateWeek('nourish', state({ level: top, bestLevel: top }), 6);

    expect(result.outcome).toBe('hit');
    expect(result.levelAfter).toBe(top);
    expect(result.rewards).toEqual([]);
  });
});

describe('missing the target', () => {
  it('holds the level after one and two misses', () => {
    const results = run('volume', [0, 0], state({ level: 5, bestLevel: 5 }));

    expect(results.map((r) => r.outcome)).toEqual(['miss', 'miss']);
    expect(results.map((r) => r.levelAfter)).toEqual([5, 5]);
    expect(last(results).next.missStreak).toBe(2);
  });

  it('drops one level on the third miss in a row, then starts counting again', () => {
    const results = run('volume', [0, 0, 0, 0], state({ level: 5, bestLevel: 5 }));

    expect(results.map((r) => r.outcome)).toEqual(['miss', 'miss', 'drop', 'miss']);
    expect(results[2]!.levelAfter).toBe(4);
    expect(results[2]!.next.missStreak).toBe(0);
    expect(results[3]!.next.missStreak).toBe(1);
  });

  it('can drop across a band boundary (the band floor protects only the week a band was entered)', () => {
    const emberFirst = firstLevelOf('volume', 'ember')!;
    const results = run('volume', [0, 0, 0], state({ level: emberFirst, bestLevel: emberFirst }));

    expect(last(results).bandBefore).toBe('ember');
    expect(last(results).bandAfter).toBe('ore');
  });

  it('never drops below level 1', () => {
    const results = run('volume', [0, 0, 0]);

    expect(last(results).outcome).toBe('drop');
    expect(last(results).levelAfter).toBe(1);
  });

  it('is a miss, not a hit, one kilogram short', () => {
    expect(evaluateWeek('volume', state(), 1999).outcome).toBe('miss');
  });

  it('keeps the best level when the athlete drops', () => {
    const results = run('volume', [0, 0, 0], state({ level: 5, bestLevel: 5 }));

    expect(last(results).next.bestLevel).toBe(5);
  });
});

describe('Forge marks and band badges', () => {
  it('awards a mark for a level reached for the first time', () => {
    const result = evaluateWeek('volume', state(), 2000);

    expect(result.rewards).toEqual([{ type: 'forge_mark', level: 2, band: 'ore' }]);
  });

  it('awards a mark for every new level an overshoot carries the athlete through', () => {
    const result = evaluateWeek('volume', state(), 3000);

    expect(result.rewards.filter((r) => r.type === 'forge_mark').map((r) => r.level)).toEqual([2, 3]);
  });

  it('awards no mark for re-reaching a level after a drop', () => {
    const results = run('volume', [0, 0, 0, targetOf('volume', 4)], state({ level: 5, bestLevel: 5 }));

    expect(last(results).levelAfter).toBe(5);
    expect(last(results).rewards).toEqual([]);
  });

  it('awards no mark for hitting the target when the level cannot rise', () => {
    const top = maxLevelOf('volume');
    const at = state({ level: top, bestLevel: top, forgedStreak: 3, bestForgedStreak: 3 });

    expect(evaluateWeek('volume', at, 1_000_000).rewards).toEqual([]);
  });

  it('awards a band badge on first entry into a band, alongside the mark', () => {
    const oreTop = topLevelOf('volume', 'ore')!;
    const result = evaluateWeek('volume', state({ level: oreTop, bestLevel: oreTop }), 5000);

    expect(result.bandAfter).toBe('ember');
    expect(result.rewards).toEqual([
      { type: 'forge_mark', level: oreTop + 1, band: 'ember' },
      { type: 'band_badge', level: oreTop + 1, band: 'ember' },
    ]);
  });

  it('awards no band badge for re-entering a band after dropping out of it', () => {
    const emberFirst = firstLevelOf('volume', 'ember')!;
    const results = run(
      'volume',
      [0, 0, 0, targetOf('volume', emberFirst - 1)],
      state({ level: emberFirst, bestLevel: emberFirst }),
    );

    expect(last(results).bandAfter).toBe('ember');
    expect(last(results).rewards).toEqual([]);
  });
});

describe('the Forged hold', () => {
  const temperedFirst = firstLevelOf('consistency', 'tempered')!; // 5 workouts
  const forgedLevel = firstLevelOf('consistency', 'forged')!; // 6 workouts

  it('counts the weeks that end inside Tempered', () => {
    const results = run('consistency', [5, 5], state({ level: temperedFirst, bestLevel: temperedFirst }));

    expect(results.map((r) => r.next.temperedHoldWeeks)).toEqual([1, 2]);
  });

  it('will not climb past the top of Tempered before four weeks are held there', () => {
    const at = state({ level: temperedFirst, bestLevel: temperedFirst, temperedHoldWeeks: FORGE_HOLD_WEEKS - 1 });
    const result = evaluateWeek('consistency', at, 6);

    expect(result.outcome).toBe('hit');
    expect(result.levelAfter).toBe(temperedFirst);
    expect(result.next.temperedHoldWeeks).toBe(FORGE_HOLD_WEEKS);
    expect(result.rewards).toEqual([]);
  });

  it('opens Forged once four weeks have been held, with the Forged reward and badge', () => {
    const at = state({ level: temperedFirst, bestLevel: temperedFirst, temperedHoldWeeks: FORGE_HOLD_WEEKS });
    const result = evaluateWeek('consistency', at, 6);

    expect(result.bandAfter).toBe('forged');
    expect(result.levelAfter).toBe(forgedLevel);
    expect(result.next.forgedStreak).toBe(1);
    expect(result.next.bestForgedStreak).toBe(1);
    expect(result.next.temperedHoldWeeks).toBe(0);
    expect(result.rewards).toEqual([
      { type: 'forge_mark', level: forgedLevel, band: 'forged' },
      { type: 'band_badge', level: forgedLevel, band: 'forged' },
      { type: 'forged', level: forgedLevel, band: 'forged' },
    ]);
  });

  it('keeps counting the hold through misses that do not drop the athlete out of Tempered', () => {
    const at = state({ level: temperedFirst, bestLevel: temperedFirst, temperedHoldWeeks: 1 });
    const results = run('consistency', [0, 0], at);

    expect(last(results).next.temperedHoldWeeks).toBe(3);
  });

  it('resets the hold when the athlete drops out of Tempered', () => {
    const at = state({ level: temperedFirst, bestLevel: temperedFirst, temperedHoldWeeks: 2 });
    const results = run('consistency', [0, 0, 0], at);

    expect(last(results).bandAfter).toBe('anvil');
    expect(last(results).next.temperedHoldWeeks).toBe(0);
  });

  it('caps an overshoot at the top of Tempered while the hold is incomplete', () => {
    // Volume: one level below the top of Tempered, a huge week would climb three, but the hold
    // is incomplete, so the athlete stops at the top of Tempered.
    const top = topLevelOf('volume', 'tempered')!;
    const at = state({ level: top - 1, bestLevel: top - 1, temperedHoldWeeks: 1 });
    const result = evaluateWeek('volume', at, 1_000_000);

    expect(result.levelAfter).toBe(top);
    expect(result.outcome).toBe('hit');
  });
});

describe('holding and losing Forged', () => {
  const forgedLevel = firstLevelOf('consistency', 'forged')!;
  const temperedTop = topLevelOf('consistency', 'tempered')!;
  const forged = state({ level: forgedLevel, bestLevel: forgedLevel, forgedStreak: 2, bestForgedStreak: 5 });

  it('adds a week to the Forged streak for every week held', () => {
    const results = run('consistency', [6, 6], forged);

    expect(results.map((r) => r.next.forgedStreak)).toEqual([3, 4]);
    expect(last(results).next.bestForgedStreak).toBe(5);
    expect(results.every((r) => r.rewards.length === 0)).toBe(true);
  });

  it('raises the best-ever streak when the current one passes it', () => {
    const results = run('consistency', [6, 6, 6, 6], forged);

    expect(last(results).next.bestForgedStreak).toBe(6);
  });

  it('cools to the top of Tempered on the first miss, keeping the best streak', () => {
    const result = evaluateWeek('consistency', forged, 5);

    expect(result.outcome).toBe('cooled');
    expect(result.levelAfter).toBe(temperedTop);
    expect(result.bandAfter).toBe('tempered');
    expect(result.next).toMatchObject({
      forgedStreak: 0,
      bestForgedStreak: 5,
      temperedHoldWeeks: 0,
      missStreak: 0,
    });
  });

  it('cools from any Forged level, not only the first', () => {
    const top = maxLevelOf('volume');
    const at = state({ level: top, bestLevel: top, forgedStreak: 1, bestForgedStreak: 1 });
    const result = evaluateWeek('volume', at, 0);

    expect(result.levelAfter).toBe(topLevelOf('volume', 'tempered'));
  });

  it('re-forges after four more weeks held, with a new Forged reward but no second badge', () => {
    const cooled = evaluateWeek('consistency', forged, 0).next;
    const results = run('consistency', [5, 5, 5, 5, 6], cooled);

    expect(results.slice(0, 4).map((r) => r.levelAfter)).toEqual([5, 5, 5, 5]);
    expect(last(results).bandAfter).toBe('forged');
    expect(last(results).rewards).toEqual([{ type: 'forged', level: forgedLevel, band: 'forged' }]);
    expect(last(results).next.forgedStreak).toBe(1);
  });
});

describe('Nourish', () => {
  it('climbs one day at a time to six days and stops at Anvil', () => {
    const results = run('nourish', [1, 2, 3, 4, 5, 6, 7]);

    expect(results.map((r) => r.levelAfter)).toEqual([2, 3, 4, 5, 6, 6, 6]);
    expect(last(results).bandAfter).toBe('anvil');
  });
});

describe('every ladder', () => {
  it.each(FORGE_LADDERS)('never leaves %s outside 1..max, whatever the totals', (ladder) => {
    const totals = [0, 1e9, 0, 0, 0, 1e9, 1e9, 1e9, 0, 3, 0, 0, 0, 0, 0, 0, 1e9];
    for (const result of run(ladder, totals)) {
      expect(result.levelAfter).toBeGreaterThanOrEqual(1);
      expect(result.levelAfter).toBeLessThanOrEqual(maxLevelOf(ladder));
    }
  });

  it('rejects a negative or non-finite total rather than evaluating nonsense', () => {
    expect(() => evaluateWeek('volume', state(), -1)).toThrow(RangeError);
    expect(() => evaluateWeek('volume', state(), Number.NaN)).toThrow(RangeError);
  });

  it('does not mutate the state it was given', () => {
    const before = state({ level: 3, bestLevel: 3 });
    const frozen = Object.freeze({ ...before });

    evaluateWeek('volume', frozen, 0);

    expect(frozen).toEqual(before);
  });
});
