import type { QuietHours } from '@forjd/domain';

// The quiet-hours editor, phone side. Pure helpers the screen row, the sheet and the time picker share, kept apart
// from the storage module so a test of the screen can run them for real.

const MINUTES_PER_HOUR = 60;
const pad = (value: number): string => String(value).padStart(2, '0');

/** A minute of the day as a 24-hour clock, "22:05". */
export function formatClock(minute: number): string {
  return `${pad(Math.floor(minute / MINUTES_PER_HOUR))}:${pad(minute % MINUTES_PER_HOUR)}`;
}

/** §5.2, verbatim: an em dash U+2014 with a space either side, not a hyphen. */
export function formatQuietHours(hours: QuietHours): string {
  return `${formatClock(hours.startMinute)} — ${formatClock(hours.endMinute)}`;
}

/**
 * A time of day in the phone's local time, the shape the time picker takes. It uses a fixed day in January, not
 * today: on the day the clocks change a time such as 02:30 may not exist, and the picker would show an hour later.
 */
export function minuteToDate(minute: number): Date {
  return new Date(2026, 0, 1, Math.floor(minute / MINUTES_PER_HOUR), minute % MINUTES_PER_HOUR, 0, 0);
}

/** The minute of the day a picked time stands for, in the phone's local time. */
export function dateToMinute(date: Date): number {
  return date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
}
