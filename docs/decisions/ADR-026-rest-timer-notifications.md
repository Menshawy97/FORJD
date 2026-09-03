# ADR-026 — The rest timer notifies with `expo-notifications`

- **Status**: Accepted
- **Date**: 2026-09-03
- **Phase**: 3H, slice H4
- **Relates to**: settles Open Question 1 of
  [`../product/phase-3-plan.md`](../product/phase-3-plan.md); implemented per
  [`../product/phase-3h-plan.md`](../product/phase-3h-plan.md)

## Context

A phone spends most of a rest period locked in a pocket. Phase 3's plan flagged this as an open
question and required it be settled *before* Phase H, because it changes the rest screen's
design rather than decorating it:

> **Does a rest timer need to survive backgrounding?** A phone locks between sets. If the timer
> must fire a notification, that is `expo-notifications` and a permissions prompt — decide
> before Phase H.

Two options were put to the user on 2026-09-02.

**A — wall-clock only, no notifications.** Store the rest period's end timestamp and recompute
the remaining time on every render and every foreground. Backgrounding is then *safe*: reopening
shows the correct remaining time, or a finished rest. No native dependency, no permission
prompt, no extra device-verification burden. It matches the prototype's `s_rest()`, which has no
notification behaviour. The cost: a locked phone never tells the athlete rest is over, so they
have to keep checking.

**B — add `expo-notifications`.** Schedule a local notification when rest starts, cancel it if
rest is skipped. The phone buzzes even while locked. The cost is a native dependency, an OS
permission prompt that needs a home in the flow, iOS/Android scheduling differences, and — since
Jest cannot exercise notification scheduling — a physical-device check that is mandatory rather
than optional.

## Decision

**Option B.** The user chose to add `expo-notifications`, accepting the cost so that a locked
phone actually buzzes when rest ends.

The wall-clock countdown from option A is **also** implemented, because it is not an
alternative to the notification but a prerequisite for it: `setInterval` in a backgrounded app
is throttled or suspended, so a tick-counting timer would drift and a phone locked for a whole
rest period would come back showing almost the full ninety seconds. Both the rest screen and the
timed-set screen recompute from an end timestamp.

## Consequences

**Everything reaches `expo-notifications` through one module**,
`apps/mobile/src/workouts/rest-notifications.ts`, and every function there takes its scheduler
injected — the same seam ADR-022 established for `expo-sqlite`. That is not ceremony: the
package has no JS implementation under Jest, so a screen calling it directly could not be
rendered in a test at all. With the seam, the whole permission/schedule/cancel surface is
covered by fakes and the rest screen stays testable.

**Permission is requested at the first rest, not at launch.** The athlete meets the prompt
mid-workout where its purpose is self-evident, which is
`rules/ecc/react-native/security.md`'s "minimum permissions, at the moment they are needed"
applied literally. A refusal is not an error state: the on-screen countdown keeps working
exactly as before, and nothing re-prompts a user whose OS says `canAskAgain: false`.

**Scheduling and cancelling are symmetric, and cancellation is the harder half.** The rest
screen can be left by expiry, by Skip Rest, by the hardware back button, or by an adjustment
that supersedes the current schedule. Every one of those cancels the outstanding notification in
the effect's cleanup, including the race where the screen unmounts before the schedule promise
resolves. A notification firing after the athlete is already back on the next set is worse than
no notification at all.

**Local only.** Nothing registers for push, requests a device token, or contacts a server, so
this adds no network dependency to the live flow (CLAUDE.md rule 6) and no new privacy surface —
which also keeps it clear of rule 15, since no health data is involved.

**A physical-device walk is now mandatory before this ships**, not optional. Jest covers the
seam's logic; it cannot prove the OS schedules or delivers anything. The walk is: start a
session, tick a set, lock the phone, confirm the notification fires when rest ends, then repeat
and confirm that skipping rest early produces no notification.

**`expo-notifications` is pinned by `npx expo install`** to the SDK 54 range (`~0.32.17`), per
`apps/mobile/AGENTS.md` — not added by hand at whatever version is newest.

## Alternatives considered and rejected

- **Option A alone** — rejected by the user, for the reason above.
- **A foreground service / persistent notification** (Android) to keep a real timer alive — far
  more invasive, platform-specific, and unnecessary once the countdown is wall-clock based.
- **Scheduling the notification from the live screen instead of the rest screen** — rejected:
  the rest screen already owns the end timestamp and every exit path, so putting the schedule
  anywhere else would split the pair that has to stay symmetric.

## Addendum — the first device walk found it silent (2026-09-03)

The walk this ADR made mandatory did its job on the first attempt: the phone stayed silent
through a locked-screen rest. Three separate defects, none of which Jest could have caught.

**1. The trigger was not a valid trigger.** `expo-notifications` 0.32 requires every object
trigger to name a `SchedulableTriggerInputTypes` value. The code passed a bare
`{ seconds }`, which schedules nothing at all — silently, with no throw.

**2. A type assertion hid it.** The seam described the input with a hand-written shape and then
cast it with `as unknown as Notifications.NotificationRequestInput`. That cast silenced the
exact compile error that would have caught the missing `type`. The seam now types the input as
the library's own `NotificationRequestInput`, so the compiler checks it — and the fix was
confirmed by `tsc` accepting the corrected trigger and nothing else changing.

**The general lesson, worth more than the bug:** a seam that exists to make a native module
testable must still be typed against that module's real interface. Describing the boundary
loosely and casting across it converts a compile-time error into a runtime silence, and a
native module's runtime silence is only observable on a device.

**3. Two delivery gaps that would have produced a second false report.** Android drops a
notification with no channel, so one is created before scheduling; and on iOS a notification
arriving while the app is foregrounded shows nothing without a `setNotificationHandler`, so an
athlete watching the countdown would have seen no alert and reasonably called it broken again.

The regression test now asserts the trigger's `type` explicitly rather than deep-equalling the
whole input, so the field that actually mattered cannot be dropped again unnoticed.
