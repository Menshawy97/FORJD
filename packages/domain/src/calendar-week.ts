/**
 * The day a week starts on, across the whole app: **Saturday** (ADR-056, the Egyptian calendar).
 *
 * Numbered like `Date#getDay()` / `Date#getUTCDay()`: 0 Sunday through 6 Saturday. Every weekly
 * figure on the server and the phone (the This week strip, the week streak, Progress's weekly
 * buckets, the leaderboard snapshot label, Weekly Forge) reads this one constant, so there is no
 * second idea of "a week" to drift from it.
 */
export const WEEK_START_DOW = 6;

const DAYS_PER_WEEK = 7;

/**
 * How many days a weekday sits after the start of its week: 0 for Saturday, 6 for Friday.
 *
 * @param dayOfWeek a `Date#getDay()`-style index, 0 Sunday through 6 Saturday.
 */
export function daysSinceWeekStart(dayOfWeek: number): number {
  return (dayOfWeek - WEEK_START_DOW + DAYS_PER_WEEK) % DAYS_PER_WEEK;
}

/**
 * The ISO weekday, 1 Monday through 7 Sunday, of a `Date#getDay()`-style index. Weekday labels on
 * the wire keep ISO numbering even though weeks start on Saturday: a weekday's name never
 * depends on where the week begins.
 */
export function isoWeekday(dayOfWeek: number): number {
  return ((dayOfWeek + 6) % DAYS_PER_WEEK) + 1;
}
