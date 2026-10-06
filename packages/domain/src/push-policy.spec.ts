import { decidePush, nextMinuteOutsideQuietHours, PUSH_MAX_AGE_MS, type PushPolicyInput } from "./push-policy";

// Phase 12F slice 3a (docs/product/phase-12f-plan.md): when a push may go out. A pure function of the switch, whether
// the person has a token, their quiet hours and time zone, "now", and when the thing happened. Owner decision
// (2026-10-06): a push that would land in quiet hours is MOVED to the first minute after them, never dropped.
const HOUR = 3_600_000;
const at = (iso: string): Date => new Date(iso);

const base = (over: Partial<PushPolicyInput> = {}): PushPolicyInput => ({
  kind: "pr",
  switchOn: true,
  hasToken: true,
  now: at("2026-10-07T12:00:00Z"),
  occurredAt: at("2026-10-07T11:55:00Z"),
  ...over,
});

describe("decidePush: when not to send", () => {
  it("drops it when the person has switched that kind off", () => {
    expect(decidePush(base({ switchOn: false }))).toEqual({ action: "drop", reason: "switch_off" });
  });

  it("drops it when the person has no token to send to", () => {
    expect(decidePush(base({ hasToken: false }))).toEqual({ action: "drop", reason: "no_token" });
  });

  it("drops a PR that is more than a day old, and keeps one a little under", () => {
    const now = at("2026-10-07T12:00:00Z");

    expect(decidePush(base({ now, occurredAt: new Date(now.getTime() - 25 * HOUR) }))).toEqual({ action: "drop", reason: "too_old" });
    expect(decidePush(base({ now, occurredAt: new Date(now.getTime() - 23 * HOUR) }))).toEqual({ action: "send_now" });
  });

  it("keeps a push that is exactly at its age limit, and treats one that has not happened yet as fresh", () => {
    const now = at("2026-10-07T12:00:00Z");

    expect(decidePush(base({ now, occurredAt: new Date(now.getTime() - 24 * HOUR) }))).toEqual({ action: "send_now" });
    expect(decidePush(base({ kind: "rank", now, occurredAt: new Date(now.getTime() - 48 * HOUR) }))).toEqual({ action: "send_now" });
    expect(decidePush(base({ now, occurredAt: new Date(now.getTime() + 5 * 60_000) }))).toEqual({ action: "send_now" });
  });

  it("drops a rank change that a night in quiet hours would make older than two days", () => {
    const decision = decidePush(base({ kind: "rank", now: at("2026-10-07T22:30:00Z"), occurredAt: at("2026-10-05T22:45:00Z") }));

    expect(decision).toEqual({ action: "drop", reason: "too_old" });
  });

  it("lets a rank change be up to two days old", () => {
    const now = at("2026-10-07T12:00:00Z");

    expect(PUSH_MAX_AGE_MS.pr).toBe(24 * HOUR);
    expect(PUSH_MAX_AGE_MS.rank).toBe(48 * HOUR);
    expect(decidePush(base({ kind: "rank", now, occurredAt: new Date(now.getTime() - 47 * HOUR) }))).toEqual({ action: "send_now" });
    expect(decidePush(base({ kind: "rank", now, occurredAt: new Date(now.getTime() - 49 * HOUR) }))).toEqual({ action: "drop", reason: "too_old" });
  });
});

describe("decidePush: quiet hours move a push, they do not drop it", () => {
  it("sends at once in the daytime (22:00 to 07:00 is the default)", () => {
    expect(decidePush(base())).toEqual({ action: "send_now" });
  });

  it("holds a push that would land at night until 07:00, the same morning or the next", () => {
    const lateEvening = decidePush(base({ now: at("2026-10-07T23:30:00Z"), occurredAt: at("2026-10-07T23:25:00Z") }));
    const smallHours = decidePush(base({ now: at("2026-10-08T03:00:00Z"), occurredAt: at("2026-10-08T02:55:00Z") }));

    expect(lateEvening).toEqual({ action: "send_at", at: at("2026-10-08T07:00:00Z") });
    expect(smallHours).toEqual({ action: "send_at", at: at("2026-10-08T07:00:00Z") });
  });

  it("treats the start as quiet and the end as not: 22:00 waits, 07:00 goes", () => {
    expect(decidePush(base({ now: at("2026-10-07T22:00:00Z"), occurredAt: at("2026-10-07T21:59:00Z") }))).toEqual({
      action: "send_at",
      at: at("2026-10-08T07:00:00Z"),
    });
    expect(decidePush(base({ now: at("2026-10-07T07:00:00Z"), occurredAt: at("2026-10-07T06:59:00Z") }))).toEqual({ action: "send_now" });
  });

  it("reads quiet hours in the person's own time zone: the Saturday 00:20 UTC snapshot is 03:20 in Cairo, so it waits for 07:00 Cairo", () => {
    const decision = decidePush(
      base({ kind: "rank", timeZone: "Africa/Cairo", now: at("2026-10-10T00:20:00Z"), occurredAt: at("2026-10-10T00:20:00Z") }),
    );

    expect(decision).toEqual({ action: "send_at", at: at("2026-10-10T04:00:00Z") });
  });

  it("follows a window the person chose, overnight or in the afternoon", () => {
    const night = decidePush(base({ quietHours: { startMinute: 23 * 60, endMinute: 6 * 60 }, now: at("2026-10-07T23:10:00Z"), occurredAt: at("2026-10-07T23:05:00Z") }));
    const afternoon = decidePush(base({ quietHours: { startMinute: 13 * 60, endMinute: 15 * 60 }, now: at("2026-10-07T14:00:00Z"), occurredAt: at("2026-10-07T13:55:00Z") }));

    expect(night).toEqual({ action: "send_at", at: at("2026-10-08T06:00:00Z") });
    expect(afternoon).toEqual({ action: "send_at", at: at("2026-10-07T15:00:00Z") });
  });

  it("uses UTC for a missing or unknown time zone, and the default window for an invalid one", () => {
    const night = { now: at("2026-10-07T23:30:00Z"), occurredAt: at("2026-10-07T23:25:00Z") };

    for (const timeZone of [null, undefined, "", "Not/AZone"]) {
      expect(decidePush(base({ ...night, timeZone }))).toEqual({ action: "send_at", at: at("2026-10-08T07:00:00Z") });
    }
    expect(decidePush(base({ ...night, quietHours: { startMinute: 600, endMinute: 600 } }))).toEqual({
      action: "send_at",
      at: at("2026-10-08T07:00:00Z"),
    });
  });

  it("drops a push whose wait would make it stale: a PR told at 22:30 after a day-old workout is not news at 07:00", () => {
    const decision = decidePush(base({ now: at("2026-10-07T22:30:00Z"), occurredAt: at("2026-10-06T22:45:00Z") }));

    expect(decision).toEqual({ action: "drop", reason: "too_old" });
  });
});

describe("nextMinuteOutsideQuietHours", () => {
  const night = { startMinute: 22 * 60, endMinute: 7 * 60 };

  it("answers now when now is already outside quiet hours", () => {
    const now = at("2026-10-07T12:00:00Z");

    expect(nextMinuteOutsideQuietHours(now, night, "UTC")).toEqual(now);
  });

  it("finds 07:00 local on the day clocks go back (New York, 1 November 2026)", () => {
    // 05:30Z is 01:30 EDT; at 06:00Z the clocks go back to 01:00 EST, so 07:00 local is 12:00Z.
    expect(nextMinuteOutsideQuietHours(at("2026-11-01T05:30:00Z"), night, "America/New_York")).toEqual(at("2026-11-01T12:00:00Z"));
  });

  it("finds 07:00 local on the day clocks go forward (New York, 8 March 2026)", () => {
    // 06:30Z is 01:30 EST; at 07:00Z the clocks go forward, so 07:00 local is 11:00Z (EDT).
    expect(nextMinuteOutsideQuietHours(at("2026-03-08T06:30:00Z"), night, "America/New_York")).toEqual(at("2026-03-08T11:00:00Z"));
  });

  it("lands after the gap when the quiet window ends at a time the clocks skip (02:30 on 8 March 2026 in New York)", () => {
    const ends0230 = { startMinute: 60, endMinute: 150 };

    // 06:50Z is 01:50 EST, still quiet; 02:30 does not exist tonight, so the window ends at 03:30 EDT = 07:30Z.
    expect(nextMinuteOutsideQuietHours(at("2026-03-08T06:50:00Z"), ends0230, "America/New_York")).toEqual(at("2026-03-08T07:30:00Z"));
  });

  it("picks the second 01:30 when the clocks go back and the window ends at a time that happens twice (1 November 2026)", () => {
    const ends0130 = { startMinute: 60, endMinute: 90 };

    // 06:10Z is the second 01:10 (EST). The first 01:30 (05:30Z) has passed, so the end is the second, 06:30Z.
    expect(nextMinuteOutsideQuietHours(at("2026-11-01T06:10:00Z"), ends0130, "America/New_York")).toEqual(at("2026-11-01T06:30:00Z"));
    // And before the first 01:30 it is the first.
    expect(nextMinuteOutsideQuietHours(at("2026-11-01T05:10:00Z"), ends0130, "America/New_York")).toEqual(at("2026-11-01T05:30:00Z"));
  });

  it("is right in zones whose offset is not a whole hour, and beyond twelve hours", () => {
    expect(nextMinuteOutsideQuietHours(at("2026-10-07T17:00:00Z"), night, "Asia/Kolkata")).toEqual(at("2026-10-08T01:30:00Z"));
    expect(nextMinuteOutsideQuietHours(at("2026-10-07T16:30:00Z"), night, "Asia/Kathmandu")).toEqual(at("2026-10-08T01:15:00Z"));
    expect(nextMinuteOutsideQuietHours(at("2026-10-07T08:30:00Z"), night, "Pacific/Kiritimati")).toEqual(at("2026-10-07T17:00:00Z"));
  });

  it("handles a quiet window that ends at midnight", () => {
    const untilMidnight = { startMinute: 20 * 60, endMinute: 0 };

    expect(nextMinuteOutsideQuietHours(at("2026-10-07T21:00:00Z"), untilMidnight, "UTC")).toEqual(at("2026-10-08T00:00:00Z"));
    expect(nextMinuteOutsideQuietHours(at("2026-10-07T12:00:00Z"), untilMidnight, "UTC")).toEqual(at("2026-10-07T12:00:00Z"));
  });

  it("rolls over a month and a year end", () => {
    expect(nextMinuteOutsideQuietHours(at("2026-12-31T23:30:00Z"), night, "UTC")).toEqual(at("2027-01-01T07:00:00Z"));
    expect(nextMinuteOutsideQuietHours(at("2026-02-28T22:30:00Z"), night, "UTC")).toEqual(at("2026-03-01T07:00:00Z"));
  });
});
