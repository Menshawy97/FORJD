import type { LeaderboardPeriod } from '@forjd/domain';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** A calendar month as one number, so months compare with `<` across a year boundary. */
const monthIndex = (year: number, month: number): number => year * 12 + (month - 1);

/** The year and month that `instant` falls in, as read on a wall clock in `timeZone`. */
function localYearMonth(instant: Date, timeZone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month') };
}

/**
 * The first instant at which `timeZone`'s own calendar says `year-month` has begun.
 *
 * Found by search, not by subtracting an offset. Local midnight on the 1st can fall inside a
 * daylight-saving gap (the clocks jump from 00:00 to 01:00, as in Havana and Asuncion), so that
 * wall-clock time does not exist and an offset-based guess lands an hour early. Asking the zone
 * which month each instant is in has no such case: the answer is the first minute that reads as
 * this month or later. No zone's offset is beyond +14 h or -12 h, so 27 h either side of UTC
 * midnight on the 1st brackets it, and the search is about a dozen lookups.
 */
function startOfMonth(year: number, month: number, timeZone: string): number {
  const target = monthIndex(year, month);
  const reached = (instant: number): boolean => {
    const local = localYearMonth(new Date(instant), timeZone);
    return monthIndex(local.year, local.month) >= target;
  };

  const anchor = Date.UTC(year, month - 1, 1);
  let low = anchor - 27 * MS_PER_HOUR; // still the previous month everywhere
  let high = anchor + 27 * MS_PER_HOUR; // already this month everywhere
  while (high - low > MS_PER_MINUTE) {
    const middle = low + Math.floor((high - low) / (2 * MS_PER_MINUTE)) * MS_PER_MINUTE;
    if (reached(middle)) high = middle;
    else low = middle;
  }
  return high;
}

/**
 * The calendar month containing `now`, in **the city's** timezone. Every athlete on one board must
 * be scored over one interval, so it is the city's month and not the device's (ADR-046).
 */
export function monthBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const { year, month } = localYearMonth(now, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: new Date(startOfMonth(year, month, timeZone)),
    end: new Date(startOfMonth(nextYear, nextMonth, timeZone)),
  };
}

/** "Sep 2026" for the month board, "all time" for the other. Rendered here so the heading cannot drift from the window. */
export function periodLabel(period: LeaderboardPeriod, now: Date, timeZone: string): string {
  if (period === 'all_time') return 'all time';
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', year: 'numeric' }).format(now);
}

/**
 * How many weeks of the month have elapsed, for scaling the WHO weekly targets. Pro-rated rather
 * than the whole month, so on the 3rd nobody is measured against four weeks of targets they
 * could not have met; never below one week, and it stops growing when the month ends.
 */
export function monthWeeks(bounds: { start: Date; end: Date }, now: Date): number {
  const elapsed = Math.min(now.getTime(), bounds.end.getTime()) - bounds.start.getTime();
  return Math.max(1, elapsed / MS_PER_WEEK);
}

/** Weeks since an athlete's first eligible session, for the all-time board. Never below one. */
export function allTimeWeeks(firstStartedAt: Date, now: Date): number {
  return Math.max(1, (now.getTime() - firstStartedAt.getTime()) / MS_PER_WEEK);
}
