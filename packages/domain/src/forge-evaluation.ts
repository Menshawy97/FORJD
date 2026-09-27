import { FORGE_BANDS, ForgeBand, ForgeLadder, ForgeOutcome, ForgeRewardType } from './forge-vocabulary';
import { bandOf, firstLevelOf, maxLevelOf, targetOf, topLevelOf } from './forge-tiers';

/**
 * Weekly Forge's rules for one ladder and one closed week (ADR-057 decision 5). Pure: no clock, no
 * database. The evaluation job folds a ladder's weeks through `evaluateWeek` in order, so the state
 * it stores is always equal to replaying the stored weekly totals from `initialForgeState`.
 */

/** A week climbs three levels at most, however far the total overshoots. */
export const FORGE_MAX_CLIMB = 3;
/** The third miss in a row drops one level. */
export const FORGE_MISSES_BEFORE_DROP = 3;
/** Weeks that must end inside Tempered before a climb may pass its top level into Forged. */
export const FORGE_HOLD_WEEKS = 4;

export interface ForgeLadderState {
  level: number;
  /** The highest level ever reached. Forge marks and band badges are only for passing it. */
  bestLevel: number;
  /** Consecutive missed weeks since the last hit or drop. */
  missStreak: number;
  /** Consecutive weeks that ended inside Tempered: the gate into Forged. */
  temperedHoldWeeks: number;
  /** Consecutive weeks that ended inside Forged. */
  forgedStreak: number;
  bestForgedStreak: number;
}

export interface ForgeReward {
  type: ForgeRewardType;
  level: number;
  band: ForgeBand;
}

export interface ForgeWeekResult {
  outcome: ForgeOutcome;
  /** The target the week was judged against: the level it started on. */
  target: number;
  levelBefore: number;
  levelAfter: number;
  bandBefore: ForgeBand;
  bandAfter: ForgeBand;
  rewards: ForgeReward[];
  next: ForgeLadderState;
}

/**
 * The rule set in force. Stored on every evaluated week, so a future change to the rules is a
 * deliberate, recorded refold rather than a silent reinterpretation of the past.
 */
export const FORGE_RULES_VERSION = 1;

/**
 * If a ladder ever loses levels, an athlete above its new top is brought down to that top before
 * their next week is evaluated (ADR-057 decision 6). Otherwise the state is returned unchanged.
 */
export function clampForgeState(ladder: ForgeLadder, state: ForgeLadderState): ForgeLadderState {
  const top = maxLevelOf(ladder);
  if (state.level <= top && state.bestLevel <= top) {
    return state;
  }
  return { ...state, level: Math.min(state.level, top), bestLevel: Math.min(state.bestLevel, top) };
}

/** Every ladder starts at Ore 1. There is no backfill from history (ADR-057 decision 10). */
export function initialForgeState(): ForgeLadderState {
  return { level: 1, bestLevel: 1, missStreak: 0, temperedHoldWeeks: 0, forgedStreak: 0, bestForgedStreak: 0 };
}

export function evaluateWeek(ladder: ForgeLadder, state: ForgeLadderState, total: number): ForgeWeekResult {
  if (!Number.isFinite(total) || total < 0) {
    throw new RangeError(`a weekly total must be a finite number of zero or more, got ${total}`);
  }

  const levelBefore = state.level;
  const target = targetOf(ladder, levelBefore);

  if (total < target) {
    return bandOf(ladder, levelBefore) === 'forged' ? cool(ladder, state, target) : miss(ladder, state, target);
  }

  // A hit earns the next level; an overshoot earns the highest level whose target the total also
  // clears. Either way the climb is capped at +3, at the ladder's top and at the Forged gate.
  const earned = Math.max(levelBefore + 1, highestCleared(ladder, total));
  const reachable = Math.min(earned, levelBefore + FORGE_MAX_CLIMB, climbCeiling(ladder, state));
  // A hit never lowers a level, even when the ceiling holds it where it is.
  const levelAfter = Math.max(reachable, levelBefore);
  return settle(ladder, state, target, levelAfter, levelAfter - levelBefore >= 2 ? 'overshoot' : 'hit', 0);
}

/** The highest level whose target the total meets. */
function highestCleared(ladder: ForgeLadder, total: number): number {
  let level = 1;
  while (level < maxLevelOf(ladder) && total >= targetOf(ladder, level + 1)) {
    level += 1;
  }
  return level;
}

/**
 * The highest level a climb may reach this week: the top of the ladder, or the top of Tempered
 * until the athlete has held Tempered for `FORGE_HOLD_WEEKS` weeks.
 */
function climbCeiling(ladder: ForgeLadder, state: ForgeLadderState): number {
  const temperedTop = topLevelOf(ladder, 'tempered');
  if (temperedTop === null || state.level > temperedTop || state.temperedHoldWeeks >= FORGE_HOLD_WEEKS) {
    return maxLevelOf(ladder);
  }
  return temperedTop;
}

function miss(ladder: ForgeLadder, state: ForgeLadderState, target: number): ForgeWeekResult {
  const misses = state.missStreak + 1;
  if (misses < FORGE_MISSES_BEFORE_DROP) {
    return settle(ladder, state, target, state.level, 'miss', misses);
  }
  // A drop may cross into a lower band: only a band entered in this same week is protected, and a
  // missed week never enters one.
  return settle(ladder, state, target, Math.max(1, state.level - 1), 'drop', 0);
}

/** Losing Forged is gentle: straight back to the top of Tempered, with the hold starting again. */
function cool(ladder: ForgeLadder, state: ForgeLadderState, target: number): ForgeWeekResult {
  // Only a ladder with a Forged band reaches here, and every such ladder has Tempered below it.
  const temperedTop = topLevelOf(ladder, 'tempered') as number;
  return {
    outcome: 'cooled',
    target,
    levelBefore: state.level,
    levelAfter: temperedTop,
    bandBefore: 'forged',
    bandAfter: 'tempered',
    rewards: [],
    next: { ...state, level: temperedTop, missStreak: 0, temperedHoldWeeks: 0, forgedStreak: 0 },
  };
}

function settle(
  ladder: ForgeLadder,
  state: ForgeLadderState,
  target: number,
  levelAfter: number,
  outcome: ForgeOutcome,
  missStreak: number,
): ForgeWeekResult {
  const bandBefore = bandOf(ladder, state.level);
  const bandAfter = bandOf(ladder, levelAfter);
  const forgedStreak = bandAfter === 'forged' ? state.forgedStreak + 1 : 0;

  return {
    outcome,
    target,
    levelBefore: state.level,
    levelAfter,
    bandBefore,
    bandAfter,
    rewards: rewardsFor(ladder, state.bestLevel, levelAfter, bandAfter === 'forged' && bandBefore !== 'forged'),
    next: {
      level: levelAfter,
      bestLevel: Math.max(state.bestLevel, levelAfter),
      missStreak,
      temperedHoldWeeks: bandAfter === 'tempered' ? state.temperedHoldWeeks + 1 : 0,
      forgedStreak,
      bestForgedStreak: Math.max(state.bestForgedStreak, forgedStreak),
    },
  };
}

/**
 * A Forge mark for every level passed for the first time (an overshoot can pass several), a band
 * badge for every band entered for the first time, and a Forged reward on entering Forged.
 */
function rewardsFor(ladder: ForgeLadder, bestLevel: number, levelAfter: number, enteredForged: boolean): ForgeReward[] {
  const rewards: ForgeReward[] = [];
  for (let level = bestLevel + 1; level <= levelAfter; level += 1) {
    rewards.push({ type: 'forge_mark', level, band: bandOf(ladder, level) });
  }
  for (const band of FORGE_BANDS) {
    const first = firstLevelOf(ladder, band);
    if (first !== null && first > bestLevel && first <= levelAfter) {
      rewards.push({ type: 'band_badge', level: first, band });
    }
  }
  if (enteredForged) {
    rewards.push({ type: 'forged', level: levelAfter, band: 'forged' });
  }
  return rewards;
}
