import { isInQuietHours, resolveQuietHours, type QuietHours } from "./local-notification-plan";

/**
 * When a push may go out (Phase 12F, docs/product/phase-12f-plan.md). Pure: the switch, whether the person has a token,
 * their quiet hours and time zone, "now" and when the thing happened go in; send now, send at a time, or drop comes out.
 * No UI and no push SDK (CLAUDE.md rules 1-2).
 *
 * Owner decision (2026-10-06): a push that would land inside the person's quiet hours is **moved to the first minute
 * after them**, not dropped. A push is dropped only when it is not wanted (switch off), cannot be delivered (no token),
 * or would be stale by the time it could go.
 */
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;

export type PushKind = "pr" | "rank";

/** How long after it happened a push is still news. A held push is judged at the time it would actually go out. */
export const PUSH_MAX_AGE_MS: Readonly<Record<PushKind, number>> = {
  pr: 24 * HOUR_MS,
  rank: 48 * HOUR_MS,
};

export interface PushPolicyInput {
  kind: PushKind;
  /** The person's switch for this kind (`pr` or `rank`). */
  switchOn: boolean;
  hasToken: boolean;
  /** Absent or invalid means 22:00 to 07:00. */
  quietHours?: QuietHours;
  /** An IANA zone such as `Africa/Cairo`; missing or unknown means UTC. */
  timeZone?: string | null;
  now: Date;
  /** When the thing happened (the session ended, the snapshot was taken). */
  occurredAt: Date;
}

export type PushDropReason = "switch_off" | "no_token" | "too_old";

export type PushDecision =
  | { action: "send_now" }
  | { action: "send_at"; at: Date }
  | { action: "drop"; reason: PushDropReason };

const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

const zoneOrUtc = (timeZone: string | null | undefined): string =>
  timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";

interface LocalParts {
  year: number;
  month: number;
  day: number;
  minuteOfDay: number;
}

const localParts = (instant: Date, timeZone: string): LocalParts => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), minuteOfDay: read("hour") * 60 + read("minute") };
};

/** The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). */
const offsetMs = (instantMs: number, timeZone: string): number => {
  const local = localParts(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, 0, local.minuteOfDay);
  return asUtc - Math.floor(instantMs / MINUTE_MS) * MINUTE_MS;
};

const DAY_MS = 86_400_000;

/**
 * Every instant at which the clocks in `timeZone` read this date and minute, earliest first: one on an ordinary day, two
 * when the clocks go back and that minute happens twice, and, when the clocks go forward and skip it, the first minute
 * after the gap (what 02:30 means on a night when 02:00 jumps to 03:00 is 03:30).
 */
const localInstants = (year: number, month: number, day: number, minuteOfDay: number, timeZone: string): number[] => {
  const guess = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  // The offsets in force a day before and a day after bracket any change that day, whichever way it goes.
  const before = offsetMs(guess - DAY_MS, timeZone);
  const after = offsetMs(guess + DAY_MS, timeZone);
  const valid = [...new Set([before, after])]
    .map((offset) => guess - offset)
    .filter((instant) => {
      const local = localParts(new Date(instant), timeZone);
      return local.year === year && local.month === month && local.day === day && local.minuteOfDay === minuteOfDay;
    })
    .sort((a, b) => a - b);
  return valid.length > 0 ? valid : [guess - before];
};

/**
 * The first moment at or after `now` that is outside the quiet hours, in the person's time zone: `now` itself when it
 * already is. An overnight window ends the same morning when it is after midnight and the next morning when it is before.
 */
export function nextMinuteOutsideQuietHours(now: Date, quietHours: QuietHours, timeZone: string | null | undefined): Date {
  const zone = zoneOrUtc(timeZone);
  const window = resolveQuietHours(quietHours);
  const local = localParts(now, zone);
  if (!isInQuietHours(local.minuteOfDay, window)) return now;

  const overnight = window.startMinute > window.endMinute;
  // Quiet and past the start of an overnight window means the end is tomorrow; every other quiet minute ends today.
  const endsTomorrow = overnight && local.minuteOfDay >= window.startMinute;
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day + (endsTomorrow ? 1 : 0)));
  const candidates = localInstants(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    window.endMinute % MINUTES_PER_DAY,
    zone,
  );
  // The first time the end is on the clock after now: on a night the clocks go back, the end may come round twice.
  const next = candidates.find((instant) => instant > now.getTime()) ?? candidates[candidates.length - 1]!;
  // Never at or before now, whatever the calendar does: a push must not go out inside quiet hours.
  return new Date(Math.max(next, now.getTime() + MINUTE_MS));
}

export function decidePush(input: PushPolicyInput): PushDecision {
  if (!input.switchOn) return { action: "drop", reason: "switch_off" };
  if (!input.hasToken) return { action: "drop", reason: "no_token" };

  const goesAt = nextMinuteOutsideQuietHours(input.now, resolveQuietHours(input.quietHours), input.timeZone);
  // Judged when it would actually go out, so a push held overnight is not told once it has gone stale.
  if (goesAt.getTime() - input.occurredAt.getTime() > PUSH_MAX_AGE_MS[input.kind]) {
    return { action: "drop", reason: "too_old" };
  }
  return goesAt.getTime() === input.now.getTime() ? { action: "send_now" } : { action: "send_at", at: goesAt };
}
