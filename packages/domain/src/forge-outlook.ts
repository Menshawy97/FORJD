import { evaluateWeek, ForgeLadderState, ForgeWeekResult } from './forge-evaluation';
import { maxLevelOf, targetOf } from './forge-tiers';
import { ForgeLadder } from './forge-vocabulary';

/**
 * What the open week would do if it closed now, for the ladder screen's "what this week does" line
 * (docs/product/weekly-forge-explainer-plan.md, X2). It runs the real rules, `evaluateWeek`, so the
 * phone can never promise something the server's evaluation would not do.
 */
export interface ForgeWeekOutlook {
  /** The week's result with the total logged so far. */
  result: ForgeWeekResult;
  /**
   * The smallest total that would do better, and the level it would end on:
   * - while the week would miss, drop or cool, the total that makes it a hit (even at the top of a
   *   ladder, where a hit keeps the level rather than raising it);
   * - once it already hits, the smallest total that ends it on a higher level.
   * Null when nothing this week can do better: the +3 cap, the top of the ladder, or the Forged hold.
   */
  nextStep: { total: number; levelAfter: number } | null;
}

export function forgeWeekOutlook(ladder: ForgeLadder, state: ForgeLadderState, total: number): ForgeWeekOutlook {
  const result = evaluateWeek(ladder, state, total);
  const goal = targetOf(ladder, state.level);

  if (total < goal) {
    return { result, nextStep: { total: goal, levelAfter: evaluateWeek(ladder, state, goal).levelAfter } };
  }

  // Already a hit. Clearing a later level's target is what earns more than one level; the level
  // straight after this one comes with the hit itself, so the candidates start one past it.
  for (let level = state.level + 2; level <= maxLevelOf(ladder); level += 1) {
    const candidate = targetOf(ladder, level);
    if (candidate <= total) {
      continue;
    }
    const levelAfter = evaluateWeek(ladder, state, candidate).levelAfter;
    if (levelAfter > result.levelAfter) {
      return { result, nextStep: { total: candidate, levelAfter } };
    }
  }
  return { result, nextStep: null };
}
