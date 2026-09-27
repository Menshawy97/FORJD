import { ForgeReward } from './forge-evaluation';
import {
  FORGE_CELEBRATIONS,
  FORGE_LADDER_IS_PUBLIC,
  ForgeBand,
  ForgeCelebration,
  ForgeLadder,
  ForgeOutcome,
} from './forge-vocabulary';

/**
 * Which celebration a closed week earns. The week-close summary shows every ladder at once and
 * plays only the single biggest celebration, so the phone never stacks modals.
 *
 * - `forged`: entering Forged, first time or re-forge. The biggest moment; shareable.
 * - `band`: a band entered for the first time (a band badge was earned). Full screen; shareable.
 * - `level`: a new level inside a band, or re-entering a band reached before. A short toast.
 * - `cooled`: Forged lost. Gentle copy, no alarm.
 * - `none`: a missed, held or dropped week. No celebration and no shame.
 *
 * Nourish is always calm: a band crossing there is only a level-up, and it never offers Share.
 */
export interface LadderWeekChange {
  ladder: ForgeLadder;
  outcome: ForgeOutcome;
  levelBefore: number;
  levelAfter: number;
  bandBefore: ForgeBand;
  bandAfter: ForgeBand;
  rewards: readonly ForgeReward[];
}

export interface LadderCelebration {
  ladder: ForgeLadder;
  celebration: ForgeCelebration;
}

export interface WeekSummary {
  biggest: ForgeCelebration;
  /** The ladder that earned the biggest celebration, or `null` when nothing was earned. */
  biggestLadder: ForgeLadder | null;
  /** Whether the biggest celebration may offer a share card. */
  shareable: boolean;
  levelsGained: number;
  marksEarned: number;
  perLadder: LadderCelebration[];
}

export function celebrationFor(change: LadderWeekChange): ForgeCelebration {
  if (change.outcome === 'cooled') {
    return 'cooled';
  }
  const calm = !FORGE_LADDER_IS_PUBLIC[change.ladder];
  if (!calm && change.rewards.some((reward) => reward.type === 'forged')) {
    return 'forged';
  }
  if (!calm && change.rewards.some((reward) => reward.type === 'band_badge')) {
    return 'band';
  }
  return change.levelAfter > change.levelBefore ? 'level' : 'none';
}

const rank = (celebration: ForgeCelebration): number => FORGE_CELEBRATIONS.indexOf(celebration);

export function summariseWeek(changes: readonly LadderWeekChange[]): WeekSummary {
  const perLadder = changes.map((change) => ({ ladder: change.ladder, celebration: celebrationFor(change) }));

  let biggest: LadderCelebration | null = null;
  for (const item of perLadder) {
    if (item.celebration !== 'none' && (biggest === null || rank(item.celebration) > rank(biggest.celebration))) {
      biggest = item;
    }
  }

  const celebration = biggest?.celebration ?? 'none';
  return {
    biggest: celebration,
    biggestLadder: biggest?.ladder ?? null,
    shareable:
      biggest !== null && FORGE_LADDER_IS_PUBLIC[biggest.ladder] && (celebration === 'band' || celebration === 'forged'),
    levelsGained: changes.reduce((sum, change) => sum + Math.max(0, change.levelAfter - change.levelBefore), 0),
    marksEarned: changes.reduce(
      (sum, change) => sum + change.rewards.filter((reward) => reward.type === 'forge_mark').length,
      0,
    ),
    perLadder,
  };
}
