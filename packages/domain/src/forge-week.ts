import { daysSinceWeekStart, WEEK_START_DOW } from './calendar-week';

/**
 * Weekly Forge's week, in an athlete's own time zone: Saturday 00:00 to the next Saturday 00:00
 * (ADR-056, ADR-057 decision 3). Uses only `Intl`, so it has no dependencies.
 *
 * A week is identified by its Saturday as a civil date, `YYYY-MM-DD`. Calendar arithmetic is done
 * on a UTC ruler (as `apps/api`'s `calendar-utils.ts` does) so a clock change never makes a week
 * the wrong length; only turning a local midnight into a real instant looks at the zone's offset.
 */

/** Until the phone sends its own zone, weeks close on Cairo time. */
export const FORGE_DEFAULT_TIME_ZONE = 'Africa/Cairo';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  );
}

function civilMs(date: string): number {
  const match = CIVIL_DATE.exec(date);
  if (!match) {
    throw new RangeError(`not a YYYY-MM-DD date: ${date}`);
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function civilString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The Saturday that starts the week an instant falls in, in the athlete's zone. */
export function forgeWeekStart(instant: Date, timeZone: string): string {
  const ms = civilMs(localDate(instant, timeZone));
  return civilString(ms - daysSinceWeekStart(new Date(ms).getUTCDay()) * MS_PER_DAY);
}

export function nextWeekStart(weekStart: string): string {
  return civilString(civilMs(weekStart) + DAYS_PER_WEEK * MS_PER_DAY);
}

export function previousWeekStart(weekStart: string): string {
  return civilString(civilMs(weekStart) - DAYS_PER_WEEK * MS_PER_DAY);
}

/** The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  const wallClock = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallClock - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a civil date's local midnight happens in a zone: the wall-clock midnight corrected by
 * the offset in force just before it. When a clock change skips midnight itself, that lands on the
 * first real instant of the day.
 */
function localMidnight(date: string, timeZone: string): Date {
  const wall = civilMs(date);
  const guess = wall - offsetAt(wall, timeZone);
  return new Date(wall - offsetAt(guess, timeZone));
}

/** The instant a week closes: the next Saturday 00:00 in the athlete's zone. */
export function weekClosesAt(weekStart: string, timeZone: string): Date {
  if (new Date(civilMs(weekStart)).getUTCDay() !== WEEK_START_DOW) {
    throw new RangeError(`a Forge week starts on a Saturday, but ${weekStart} is not one`);
  }
  return localMidnight(nextWeekStart(weekStart), timeZone);
}

/** Days left in the current week, counting today: 7 on Saturday, 1 on Friday. */
export function weekDaysLeft(now: Date, timeZone: string): number {
  const today = civilMs(localDate(now, timeZone));
  return DAYS_PER_WEEK - daysSinceWeekStart(new Date(today).getUTCDay());
}
