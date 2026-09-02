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
 * The seven "This week" columns, Monday-first as the prototype renders them (M T W T F S S),
 * paired with the weekday index `Date#getDay()` returns so a caller can tell which column is
 * today without a second date calculation.
 */
export const WEEK_DAYS = [
  { letter: 'M', name: 'Monday', dayIndex: 1 },
  { letter: 'T', name: 'Tuesday', dayIndex: 2 },
  { letter: 'W', name: 'Wednesday', dayIndex: 3 },
  { letter: 'T', name: 'Thursday', dayIndex: 4 },
  { letter: 'F', name: 'Friday', dayIndex: 5 },
  { letter: 'S', name: 'Saturday', dayIndex: 6 },
  { letter: 'S', name: 'Sunday', dayIndex: 0 },
] as const;
