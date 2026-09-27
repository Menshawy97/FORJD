import type { ForgeLadderProgress } from '@forjd/contracts';
import { bandOf, FORGE_HOLD_WEEKS, forgeWeekOutlook, maxLevelOf } from '@forjd/domain';

import { formatForgeAmount, unitLabel } from './forge-format';

/**
 * The ladder screen's "what this week does" line (weekly-forge-explainer-plan.md, X3; mock-ups D and
 * E). Worked out with `forgeWeekOutlook`, which runs the server's own rules, so the line can never
 * promise what Saturday's evaluation would not do.
 *
 * A hold count missing from an older API reads as none held: the line then never offers Forged
 * before the four Tempered weeks are done.
 */
export function outlookLine(progress: ForgeLadderProgress): string {
  const { ladder, level, total } = progress;
  const { result, nextStep } = forgeWeekOutlook(
    ladder,
    {
      level,
      bestLevel: level,
      missStreak: progress.missStreak,
      temperedHoldWeeks: progress.temperedHoldWeeks ?? 0,
      forgedStreak: progress.forgedStreak,
      bestForgedStreak: progress.bestForgedStreak,
    },
    total,
  );
  const amount = (value: number) => `${formatForgeAmount(value, progress.unit)} ${unitWord(progress, value)}`;
  const isForged = bandOf(ladder, level) === 'forged';
  const isTop = level === maxLevelOf(ladder);

  if (total < progress.target) {
    const goal = progress.target;
    if (isForged) {
      const action = ladder === 'consistency' ? `Finish ${amount(goal)}` : `Reach ${amount(goal)}`;
      return `You're Forged. ${action} by Friday to stay Forged.${soFar(progress, amount)}`;
    }
    const action = shortAction(progress, amount(goal));
    const levelAfter = nextStep?.levelAfter ?? result.levelAfter;
    if (levelAfter === level) {
      return ladder === 'nourish'
        ? `${action} by Friday to stay at the top of Nourish.`
        : `${action} by Friday to stay at level ${level}, the top.`;
    }
    const topOfNourish = ladder === 'nourish' && levelAfter === maxLevelOf(ladder) ? ', the top of Nourish' : '';
    return `${action} by Friday to reach level ${levelAfter}${topOfNourish}.`;
  }

  if (nextStep) {
    return `${amount(total)} takes you to level ${result.levelAfter} on Saturday. Reach ${amount(nextStep.total)} by Friday to jump to level ${nextStep.levelAfter}.`;
  }
  if (result.levelAfter > level) {
    return `${amount(total)} takes you to level ${result.levelAfter} on Saturday.`;
  }
  if (isForged) {
    return `${amount(total)} keeps you Forged.`;
  }
  if (isTop) {
    return ladder === 'nourish'
      ? `${amount(total)} keeps you at the top of Nourish.`
      : `${amount(total)} keeps you at the top level.`;
  }
  // The only other way a met goal stays put: the top of Tempered before the hold is complete.
  return `${amount(total)} meets the goal. Forged opens after ${FORGE_HOLD_WEEKS} weeks in a row in Tempered.`;
}

function shortAction(progress: ForgeLadderProgress, goal: string): string {
  if (progress.ladder === 'nourish') return `Log meals on ${goal}`;
  if (progress.ladder === 'consistency') return `Finish ${goal}`;
  return `Hit ${goal}`;
}

function soFar(progress: ForgeLadderProgress, amount: (value: number) => string): string {
  if (progress.total <= 0) return '';
  return progress.ladder === 'consistency'
    ? ` ${formatForgeAmount(progress.total, progress.unit)} done so far.`
    : ` ${amount(progress.total)} so far.`;
}

/** "workout" and "day" for exactly one; every other unit reads the same for any amount. */
function unitWord(progress: ForgeLadderProgress, value: number): string {
  if (value === 1 && progress.unit === 'workouts') return 'workout';
  if (value === 1 && progress.unit === 'days') return 'day';
  return unitLabel(progress.unit);
}
