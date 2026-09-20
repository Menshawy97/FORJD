import type { LeaderboardRow } from '@forjd/contracts';
import type { LeaderboardMetric } from '@forjd/domain';

/**
 * The Rank tab's text, kept out of the components so the wording and the arithmetic are testable
 * on their own. Every figure here comes from the server; nothing is a literal from the prototype.
 */

export const RANK_CHIPS: readonly { label: string; value: LeaderboardMetric }[] = [
  { label: 'Activity', value: 'activity' },
  { label: 'Strength', value: 'strength' },
  { label: 'Running', value: 'running' },
  { label: 'HYROX', value: 'hyrox' },
];

export const RANK_PERIODS = [
  { label: 'This Month', value: 'month' as const },
  { label: 'All Time', value: 'all_time' as const },
];

export type DeltaTone = 'up' | 'down' | 'flat';

export interface DeltaView {
  /** "↑2", "↓1" or "—". */
  text: string;
  tone: DeltaTone;
}

/**
 * Weekly movement for a list row. Positive means moved up. `null` (no baseline yet, a new
 * athlete, a city too small last week) returns `null` and draws nothing, rather than a dash that
 * would read as "no change".
 */
export function deltaView(delta: number | null): DeltaView | null {
  if (delta === null) return null;
  if (delta > 0) return { text: `↑${delta}`, tone: 'up' };
  if (delta < 0) return { text: `↓${Math.abs(delta)}`, tone: 'down' };
  return { text: '—', tone: 'flat' };
}

/** The line beside the big rank number: "↑ 3 this week". */
export function weekLine(delta: number | null): DeltaView | null {
  if (delta === null) return null;
  if (delta > 0) return { text: `↑ ${delta} this week`, tone: 'up' };
  if (delta < 0) return { text: `↓ ${Math.abs(delta)} this week`, tone: 'down' };
  return { text: 'No change this week', tone: 'flat' };
}

/** One decimal, always: 92.7, and 90.0 rather than 90. */
export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function metricLabel(metric: LeaderboardMetric): string {
  return RANK_CHIPS.find((chip) => chip.value === metric)?.label ?? metric;
}

/** "Activity score — Sep 2026". The window text is the server's, so it cannot drift from the query. */
export function listHeading(metric: LeaderboardMetric, periodLabel: string): string {
  return `${metricLabel(metric)} score — ${periodLabel}`;
}

export function rowName(row: Pick<LeaderboardRow, 'displayName' | 'isSelf'>): string {
  return row.isSelf ? `${row.displayName} (you)` : row.displayName;
}
