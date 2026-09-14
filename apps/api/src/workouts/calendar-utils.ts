/**
 * Free-standing calendar/date arithmetic shared by the workouts repositories (`statsForUser`
 * in `workout-sessions.repository.ts`) and `progress.repository.ts`'s own calendar reads.
 * Extracted from `workouts.repository.ts` (R23c) -- these were previously private helpers on
 * that file's single class; nothing here touches `this.db`, so none of it needs to be a method.
 */

/** `YYYY-MM-DD` in the given zone. `en-CA` is the locale that formats exactly this shape. */
export function localCalendarDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A `YYYY-MM-DD` civil date as milliseconds, read as though it were UTC midnight.
 *
 * Deliberately *not* the real instant that date began in the athlete's zone. Once a timestamp
 * has been resolved to a calendar day, everything built on it here -- which weekday, which
 * Monday, how many weeks back -- is calendar arithmetic, and doing that on a UTC ruler is what
 * stops a daylight-saving transition from making one week 167 hours long and shifting every
 * weekday index inside it by one.
 */
export function civilDateMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function civilDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The Monday of the week a civil date falls in -- the week the mobile app's own strip draws. */
export function weekStartOf(date: string): string {
  const ms = civilDateMs(date);
  // getUTCDay() is Sunday-based; adding 6 and taking mod 7 rotates it so Monday is 0.
  const offset = (new Date(ms).getUTCDay() + 6) % 7;
  return civilDateString(ms - offset * MS_PER_DAY);
}

/**
 * Consecutive weeks, ending with the current one or the one immediately before it, that
 * contain at least one completed session.
 *
 * **The current week is allowed to be empty without breaking the streak.** Measured on a
 * Monday morning, a streak that required the current week would reset every week before the
 * athlete had any chance to train -- so a streak that reached last week is still alive, and
 * only falls to zero once the week before that is empty too.
 */
export function countWeekStreak(trainedWeekStarts: Set<string>, currentWeekStart: string): number {
  let cursor = civilDateMs(currentWeekStart);
  if (!trainedWeekStarts.has(currentWeekStart)) {
    cursor -= 7 * MS_PER_DAY;
  }

  let streak = 0;
  while (trainedWeekStarts.has(civilDateString(cursor))) {
    streak += 1;
    cursor -= 7 * MS_PER_DAY;
  }
  return streak;
}
