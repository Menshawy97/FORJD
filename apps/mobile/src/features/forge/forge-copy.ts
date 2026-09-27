import type { ForgeWeekSummary } from '@forjd/contracts';
import { FORGE_BAND_NAMES, FORGE_COPY, FORGE_LADDER_IS_PUBLIC, FORGE_LADDER_NAMES, targetOf } from '@forjd/domain';

import { formatForgeAmount, unitLabel, type ForgeUnit } from './forge-format';

/**
 * The words for a closed Weekly Forge week, as approved in the Phase 7 mock-ups (items D, G and H).
 * Every line is derived from the server's week summary, so the app never re-decides what happened.
 *
 * The tone of a result label is carried separately from its words, so a result never depends on
 * colour alone to be understood: "Held" reads as held whatever it is drawn in.
 */
type LadderWeek = ForgeWeekSummary['ladders'][number];

export type ChipTone = 'up' | 'band' | 'hold';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAYS_IN_WEEK_AFTER_START = 6;

/** "19 – 25 Sep" for the week starting that Saturday; "26 Sep – 2 Oct" when it crosses a month. */
export function weekRangeLabel(weekStart: string): string {
  const [year, month, day] = weekStart.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(Date.UTC(year, month - 1, day + DAYS_IN_WEEK_AFTER_START));
  const startMonth = MONTHS[start.getUTCMonth()];
  const endMonth = MONTHS[end.getUTCMonth()];
  return startMonth === endMonth
    ? `${start.getUTCDate()} – ${end.getUTCDate()} ${endMonth}`
    : `${start.getUTCDate()} ${startMonth} – ${end.getUTCDate()} ${endMonth}`;
}

/** The result label on a summary row, and the tone it is drawn in. */
export function outcomeChip(week: LadderWeek): { label: string; tone: ChipTone } {
  switch (week.outcome) {
    case 'miss':
      return { label: 'Held', tone: 'hold' };
    case 'drop':
      return { label: `Eased to ${week.levelAfter}`, tone: 'hold' };
    case 'cooled':
      return { label: 'Cooled', tone: 'hold' };
    case 'hit':
    case 'overshoot': {
      // The server's own verdict decides "New band": Nourish enters bands too, but stays calm.
      if (week.celebration === 'band' || week.celebration === 'forged') {
        return { label: 'New band', tone: 'band' };
      }
      const gained = week.levelAfter - week.levelBefore;
      if (gained <= 0) {
        return { label: 'Target met', tone: 'up' };
      }
      return gained === 1
        ? { label: `Level ${week.levelBefore} → ${week.levelAfter}`, tone: 'up' }
        : { label: `+${gained} levels`, tone: 'up' };
    }
  }
}

/** The line under a summary row: the week's total against its target, and what it means next. */
export function outcomeDetail(week: LadderWeek, unit: ForgeUnit): string {
  if (week.outcome === 'cooled') {
    return FORGE_COPY.cooled;
  }
  const amounts = `${formatForgeAmount(week.total, unit)} of ${formatForgeAmount(week.target, unit)} ${unitLabel(unit)}`;
  switch (week.outcome) {
    case 'miss':
      return `${amounts} · stays at level ${week.levelAfter}`;
    case 'drop':
      return `${amounts} · next target ${formatForgeAmount(targetOf(week.ladder, week.levelAfter), unit)} ${unitLabel(unit)}`;
    default:
      return week.levelAfter > week.levelBefore
        ? `${amounts} · level ${week.levelBefore} → ${week.levelAfter}`
        : `${amounts} · top level`;
  }
}

/**
 * The level-up toast: "Struck." and what changed. Nourish is calm, so it gets no flavour line:
 * "Nourish reached Ember." for a new band, "Nourish rose to level 4." otherwise.
 */
export function toastLine(week: LadderWeek): string {
  const name = FORGE_LADDER_NAMES[week.ladder];
  if (!FORGE_LADDER_IS_PUBLIC[week.ladder]) {
    return week.bandAfter !== week.bandBefore
      ? `${name} reached ${FORGE_BAND_NAMES[week.bandAfter]}.`
      : `${name} rose to level ${week.levelAfter}.`;
  }
  const gained = week.levelAfter - week.levelBefore;
  return gained > 1
    ? `${FORGE_COPY.level} ${name} climbed ${gained} levels to level ${week.levelAfter}.`
    : `${FORGE_COPY.level} ${name} rose to level ${week.levelAfter}.`;
}
