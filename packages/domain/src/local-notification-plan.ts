import { WEEK_START_DOW } from "./calendar-week";

/**
 * The plan for the notifications the phone schedules for itself (Phase 12E, ADR-064,
 * `docs/product/phase-12e-plan.md`). Pure: switches, the current local date and time, and the person's
 * recent history go in, and the list of notifications for the next fortnight comes out. No UI, no SDK
 * (CLAUDE.md rules 1-2), so every rule here is covered by plain unit tests.
 *
 * Dates are local calendar dates as `YYYY-MM-DD` strings and times are minutes since local midnight, so
 * nothing in here depends on the process time zone or on daylight saving. Turning a planned date and minute
 * into an instant is the phone's job, at the moment it schedules.
 */

/** The notification kinds planned so far. Later 12E slices add more. */
export type LocalNotificationKind = "workout" | "weekly";

export interface LocalDateTime {
  /** `YYYY-MM-DD`, in the person's local calendar. */
  date: string;
  /** Minutes since local midnight, 0 to 1439. */
  minute: number;
}

/** A completed session the person started, in local terms. */
export interface TrainingSessionStart {
  date: string;
  startMinute: number;
}

/** One workout of the person's own custom program, pinned to a weekday (`Date#getDay()`: 0 Sunday to 6 Saturday). */
export interface ProgramWeekdayWorkout {
  dayOfWeek: number;
  workoutName: string;
}

export interface LocalNotificationPlanInput {
  now: LocalDateTime;
  switches: { workout: boolean; weekly: boolean };
  /** Completed sessions, any order; only the last four weeks are used. */
  recentSessions: readonly TrainingSessionStart[];
  /** Empty for a preset program or no program: those prescribe no weekdays (`program_workouts.day_of_week`). */
  programWorkouts: readonly ProgramWeekdayWorkout[];
}

export interface PlannedLocalNotification {
  /** Deterministic, `forjd-local:<kind>:<date>`, so the phone can find and cancel what it scheduled. */
  id: string;
  kind: LocalNotificationKind;
  date: string;
  minute: number;
  title: string;
  body: string;
  /** The app route a tap opens. */
  route: string;
}

/** Today and the 13 days after it. */
export const LOCAL_NOTIFICATION_HORIZON_DAYS = 14;
/** Kept well under iOS's limit of 64 pending local notifications. */
export const MAX_PENDING_LOCAL_NOTIFICATIONS = 60;
export const WORKOUT_REMINDER_LEAD_MINUTES = 30;
/** Nothing is sent from 22:00 up to 07:00, until a quiet-hours editor exists. */
export const QUIET_HOURS_START_MINUTE = 22 * 60;
export const QUIET_HOURS_END_MINUTE = 7 * 60;
/** The recap arrives right after the Saturday-to-Friday week closes (ADR-056). */
export const WEEKLY_RECAP_MINUTE = 9 * 60;

const HABIT_WINDOW_DAYS = 28;
const HABIT_BLOCK_DAYS = 7;
/** A weekday counts as a habit when it was trained in this many of the last four weeks. */
const HABIT_MIN_WEEKS = 2;
const MS_PER_DAY = 86_400_000;
const START_ROUNDING_MINUTES = 5;
const LAST_MINUTE_OF_DAY = 24 * 60 - 1;
const LOCAL_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const WEEKDAY_OF_EPOCH_DAY_ZERO = 4; // 1970-01-01 was a Thursday.

const dayNumber = (date: string): number => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
};

const dateOfDayNumber = (days: number): string => new Date(days * MS_PER_DAY).toISOString().slice(0, 10);

const weekdayOfDayNumber = (days: number): number => (((days + WEEKDAY_OF_EPOCH_DAY_ZERO) % 7) + 7) % 7;

// The types promise 'YYYY-MM-DD' and 0 to 1439, but the values come from the server and the phone's clock, so
// they are checked rather than trusted: a bad date or minute is ignored, never turned into NaN or a throw.
const isValidLocalDate = (date: string): boolean =>
  LOCAL_DATE_PATTERN.test(date) && dateOfDayNumber(dayNumber(date)) === date;

const isValidMinuteOfDay = (minute: number): boolean => Number.isInteger(minute) && minute >= 0 && minute <= LAST_MINUTE_OF_DAY;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** The usual start, rounded to the nearest five minutes so the reminder reads as a natural time. */
const usualStart = (starts: readonly number[]): number =>
  Math.round(median(starts) / START_ROUNDING_MINUTES) * START_ROUNDING_MINUTES;

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const inQuietHours = (minute: number): boolean => minute >= QUIET_HOURS_START_MINUTE || minute < QUIET_HOURS_END_MINUTE;

interface Habit {
  /** Start minutes of the window's sessions, by weekday. */
  startsByWeekday: Map<number, number[]>;
  /** For each weekday, in how many of the last four weeks it was trained. */
  weeksByWeekday: Map<number, Set<number>>;
  allStarts: number[];
}

/** The last four weeks, as four consecutive seven-day blocks ending today. */
const readHabit = (sessions: readonly TrainingSessionStart[], today: number): Habit => {
  const habit: Habit = { startsByWeekday: new Map(), weeksByWeekday: new Map(), allStarts: [] };
  for (const session of sessions) {
    const sessionDay = dayNumber(session.date);
    const ago = today - sessionDay;
    if (ago < 0 || ago >= HABIT_WINDOW_DAYS) continue;
    const weekday = weekdayOfDayNumber(sessionDay);
    habit.allStarts.push(session.startMinute);
    habit.startsByWeekday.set(weekday, [...(habit.startsByWeekday.get(weekday) ?? []), session.startMinute]);
    const weeks = habit.weeksByWeekday.get(weekday) ?? new Set<number>();
    weeks.add(Math.floor(ago / HABIT_BLOCK_DAYS));
    habit.weeksByWeekday.set(weekday, weeks);
  }
  return habit;
};

interface ReminderPlan {
  startMinute: number;
  body: string;
}

/**
 * When to remind on a given weekday, or `null` to stay quiet. A custom program's weekdays decide the days
 * (ADR-064 decision 3); with no program, a weekday qualifies when it was trained in at least two of the last
 * four weeks. Either way a reminder needs a start time from the person's own history: with none, it stays
 * quiet rather than guess.
 */
const reminderFor = (
  weekday: number,
  habit: Habit,
  programWorkouts: readonly ProgramWeekdayWorkout[],
  programWeekdays: ReadonlySet<number>,
): ReminderPlan | null => {
  const onProgram = programWeekdays.size > 0;
  if (onProgram ? !programWeekdays.has(weekday) : (habit.weeksByWeekday.get(weekday)?.size ?? 0) < HABIT_MIN_WEEKS) {
    return null;
  }
  const starts = habit.startsByWeekday.get(weekday) ?? habit.allStarts;
  if (starts.length === 0) return null;
  const start = usualStart(starts);
  const workout = onProgram ? programWorkouts.find((entry) => entry.dayOfWeek === weekday) : undefined;
  return { startMinute: start, body: workout ? `${workout.workoutName} is next.` : `You usually start around ${clock(start)}.` };
};

/** Keeps the earliest `max` notifications and drops the furthest, so the phone never nears its pending limit. */
export function limitPlannedNotifications(
  plan: readonly PlannedLocalNotification[],
  max: number = MAX_PENDING_LOCAL_NOTIFICATIONS,
): PlannedLocalNotification[] {
  return plan.slice(0, max);
}

/**
 * The notifications to schedule for the next 14 days, in time order. Recomputed from scratch each time the
 * phone reconciles (ADR-064): nothing here remembers a previous plan.
 */
export function planLocalNotifications(input: LocalNotificationPlanInput): PlannedLocalNotification[] {
  if (!isValidLocalDate(input.now.date) || !isValidMinuteOfDay(input.now.minute)) return [];
  const sessions = input.recentSessions.filter(
    (session) => isValidLocalDate(session.date) && isValidMinuteOfDay(session.startMinute),
  );
  const today = dayNumber(input.now.date);
  const habit = readHabit(sessions, today);
  const trainedToday = sessions.some((session) => session.date === input.now.date);
  const programWeekdays = new Set(
    input.programWorkouts.map((entry) => entry.dayOfWeek).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  );
  const plan: PlannedLocalNotification[] = [];

  for (let offset = 0; offset < LOCAL_NOTIFICATION_HORIZON_DAYS; offset += 1) {
    const day = today + offset;
    const date = dateOfDayNumber(day);
    const weekday = weekdayOfDayNumber(day);
    const isToday = offset === 0;
    const stillAhead = (minute: number): boolean => !isToday || minute > input.now.minute;

    if (input.switches.workout && !(isToday && trainedToday)) {
      const reminder = reminderFor(weekday, habit, input.programWorkouts, programWeekdays);
      // A negative minute (a start before 00:30) is inside quiet hours too, so one check covers both.
      const minute = reminder === null ? 0 : reminder.startMinute - WORKOUT_REMINDER_LEAD_MINUTES;
      if (reminder !== null && !inQuietHours(minute) && stillAhead(minute)) {
        plan.push({
          id: `forjd-local:workout:${date}`,
          kind: "workout",
          date,
          minute,
          title: "Workout in 30 minutes",
          body: reminder.body,
          route: "/train",
        });
      }
    }

    if (input.switches.weekly && weekday === WEEK_START_DOW && stillAhead(WEEKLY_RECAP_MINUTE)) {
      plan.push({
        id: `forjd-local:weekly:${date}`,
        kind: "weekly",
        date,
        minute: WEEKLY_RECAP_MINUTE,
        title: "Your week is ready",
        body: "See how it went.",
        route: "/progress",
      });
    }
  }

  plan.sort((a, b) => a.date.localeCompare(b.date) || a.minute - b.minute || a.kind.localeCompare(b.kind));
  return limitPlannedNotifications(plan);
}
