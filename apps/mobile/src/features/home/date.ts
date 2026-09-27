/**
 * Home's date line -- the prototype writes it as `Tuesday, 19 Aug`.
 *
 * Built from fixed name tables rather than `Intl.DateTimeFormat`, for two reasons. First,
 * no locale produces this exact shape: `en-GB` gives "Tuesday 19 Aug" (no comma) and `en-US`
 * gives "Tuesday, Aug 19" (month first), so either would silently ship a different string
 * than the design. Second, Hermes is built with a trimmed ICU on Android, so locale output is
 * not guaranteed to match what Node prints in a test.
 *
 * This is deliberately *not* the same thing as `src/nutrition/date.ts`'s `todayLocalDate()`,
 * which produces the `YYYY-MM-DD` the API keys a nutrition log by. That one is a wire format;
 * this one is display copy.
 */
import { daysSinceWeekStart } from '@forjd/domain';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatHomeDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * The seven "This week" columns, Saturday-first (S S M T W T F): the week runs Saturday to Friday
 * across the whole app (ADR-056), which is the week the server counts sessions in. The prototype
 * drew them Monday-first; only the order changed, not the styling. Each is paired with the
 * weekday index `Date#getDay()` returns, so a caller can tell which column is today without a
 * second date calculation. The order comes from `daysSinceWeekStart`, so it follows
 * `WEEK_START_DOW` rather than restating it.
 */
export const WEEK_DAYS = WEEKDAYS.map((name, dayIndex) => ({ letter: name.charAt(0), name, dayIndex })).sort(
  (a, b) => daysSinceWeekStart(a.dayIndex) - daysSinceWeekStart(b.dayIndex),
);
