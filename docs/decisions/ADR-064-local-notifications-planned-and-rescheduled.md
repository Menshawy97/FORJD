# ADR-064: Local notifications are planned by a pure function and rescheduled, not patched

**Status:** Accepted (2026-10-05, by the owner, with the 12E plan).
**Date:** 2026-10-05
**Plan:** [phase-12e-plan.md](../product/phase-12e-plan.md). **Builds on:**
[ADR-026](ADR-026-rest-timer-notifications.md) (the `expo-notifications` seam),
[ADR-061](ADR-061-what-a-notification-may-say.md) (what a notification may say).

## Context

Phase 12E adds notifications the phone schedules for itself: workout reminders, a weekly recap and four more
reminders. They depend on facts that change under the schedule (the person trains, logs a meal, edits a
program, turns a switch off), and a scheduled local notification cannot look anything up when it fires. The
rest timer (ADR-026) schedules one notification for the next minute or two and cancels it on every exit; that
approach does not scale to a fortnight of reminders whose conditions drift.

## Decision

1. **The schedule is a pure function of facts.** `@forjd/domain` gets a planner that takes the switches, the
   current local date and time, the person's recent sessions, the followed program's weekdays and the other
   inputs, and returns the notifications for the **next 14 days**. No UI, no SDK, fully unit-tested (CLAUDE.md
   rules 1-2).
2. **The phone reconciles; it never patches.** A reconciler cancels every FORJD-planned local notification
   (deterministic ids, `forjd-local:<kind>:<date>`) and schedules the plan again. It runs on launch, on
   returning to the foreground, when a switch changes and after a workout, meal, program or scan change. It is
   idempotent, so running it often is safe and a missed trigger heals on the next one.
3. **Reminders learn from the person's own history.** A weekday qualifies when they trained on it in at least
   two of the last four weeks; the reminder is 30 minutes before their median start on that weekday. A custom
   program's weekdays decide the days. With too little history nothing is scheduled: it stays quiet rather than
   guess.
4. **Quiet hours are fixed at 22:00 to 07:00** until a quiet-hours editor exists. A reminder that would fall in
   the window is dropped, not moved. Each kind sends at most one notification a day, and none for something the
   person has already done.
5. **A rolling 14-day horizon.** It keeps the pending count well under iOS's 64-notification limit (a guard
   drops the furthest if the plan nears 60). If the app is not opened for 14 days the reminders stop, which is
   right for a dormant person.
6. **Text is composed on the phone, so values are allowed** (ADR-061 decision 3). The weekly recap is nevertheless
   a **fixed message with no numbers**, because a notification scheduled in advance would show stale figures.
   Server push (12F) is built, but its text carries no numbers either (ADR-061): it names an exercise or a city and opens the screen that has the figures.
7. **The scheduler stays behind the ADR-026 seam**, injected, and typed against the library's own types (never an
   `as unknown as` cast, which hid a silent failure there). A physical-device walk is mandatory before each kind
   ships, as in ADR-026: Jest cannot prove the OS delivers anything.

## Consequences

- Behaviour is testable without a phone: the planner is plain data in and data out, and the reconciler runs
  against a fake scheduler.
- A notification already handed to the OS cannot be recalled while the app is closed, so a nudge can arrive just
  after the person did the thing. Recomputing on every foreground and after every relevant action keeps this
  window small; it is accepted.
- Reminders are best effort. Android battery managers and an unopened app can drop them; the FAQ says so.
- Four new switches (meals, no workout this week, Weekly Forge closing, monthly weigh-in) are added in a later
  slice with an additive server column each, default off, and a mock-up the owner approves first.
- `data-inventory.md` and the FAQ say what these notifications contain and that they never leave the phone.
