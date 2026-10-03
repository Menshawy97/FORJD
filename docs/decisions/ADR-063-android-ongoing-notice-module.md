# ADR-063: A small native Android module for ticking lock-screen notices

**Status:** Accepted (2026-10-03, by the owner: "Live ticking countdown").
**Date:** 2026-10-03
**Plan:** [phase-12b-plan.md](../product/phase-12b-plan.md) (slice 12B, the strength workout on the
lock screen). **Related:** ADR-026 (rest notification), ADR-059 (run notice), ADR-061 (what a
notification may say), ADR-062 (iPhone Live Activities).

## Context

The owner approved a 12B design (2026-10-03, after their Hevy example) whose rest card shows a **live,
ticking countdown** on the lock screen. On Android, `expo-notifications` 57 cannot draw that:
`ExpoNotificationBuilder` sets no chronometer (`setUsesChronometer`/`setChronometerCountDown`) and no
`setOnlyAlertOnce`. Ticking it from JavaScript is not an option either: a strength session has no
foreground service (unlike a run, ADR-059), so with the phone locked the app's JavaScript may be paused
or the process stopped, and the number would freeze.

Android itself can do it: a notification with `setUsesChronometer(true)`, `setChronometerCountDown(true)`
and `setWhen(restEndsAtMs)` is redrawn by the system every second, needs no app code to tick, and stays
exact with the screen off and the app asleep (API 24+; the app's minimum is above that).

Asked to choose between a fixed "Rest ends at 4:33", this native module, or no Android card, the owner
chose the live countdown.

## Decision

1. **A local Expo module, Android only (Kotlin)**, created with the generator, never hand-scaffolded:
   `npx create-expo-module@latest --local forjd-ongoing-notice`, under `apps/mobile/modules/`. It is
   autolinked, so it adds no config-plugin code. The smallest surface that does the job:
   - `show({ id, channelId, title, text, subText, color, chronometer, actions })`, where `chronometer`
     is `{ countDownToMs }` or `{ countUpFromMs }` or absent; `setOnlyAlertOnce(true)`, ongoing,
     low-importance channel; the FORJD symbol as the small icon.
   - `dismiss(id)`.
   - An `onAction` event (`{ noticeId, actionId }`) from a `BroadcastReceiver` when the app is
     running; an action marked `opensApp` starts the app with the action in its intent instead, which
     covers a process Android has stopped.
2. **Behind a seam**: JavaScript reaches it only through `apps/mobile/src/integrations/notifications/`,
   with an injected fake for Jest (the ADR-026 pattern). The conformance check gains a rule: the module
   is imported nowhere else.
3. **What may go in it** is unchanged: local notices only, built on the phone, so values are allowed
   (ADR-061 decision 3). No push, no network.
4. **Verified on a physical Android phone before merge**, in the spirit of CLAUDE.md rule 16: Kotlin is
   not exercised by Jest or CI, so the countdown, the buttons and the dismiss are walked on a device.
5. **iPhone** gets the same card as a Live Activity through `expo-widgets` (ADR-062), with Phase 11. No
   Swift is written for this ADR.
6. **The run notice keeps `expo-notifications`.** The owner was shown the run notice with a time ticking
   every second (Android can only tick it in the header line, beside the app name, with the distance alone
   in the title) and chose to keep the approved replica v2, updated every 5 s (2026-10-03).

## Amendment — how 12B-1 built it (2026-10-03)

- **No timer runs below zero.** A countdown times out at zero (`setTimeoutAfter`), and the module posts the
  notice's `then` content (the next set) in its place from an alarm, without JavaScript, because a
  strength session has no foreground service and its JavaScript may be frozen. The alarm is exact where
  Android allows it without a new permission (before Android 12) and otherwise "allowed while idle",
  which Android may deliver a little late; the timeout covers that gap and the rest-complete alert
  (ADR-026) still fires. No exact-alarm permission is added.
- **A swipe is respected.** Android 14 lets people swipe ongoing notices away; the delete intent then
  cancels the pending follow-up so it cannot bring the notice back (a removal within a second of zero is
  the timeout's own, and keeps the follow-up).
- **Taps made while the app was stopped are kept, not lost.** Actions that act in the background go to an
  unexported `BroadcastReceiver`; when no JavaScript listens, the tap is written to a small on-phone list
  (ids only, at most 20) that the seam hands over, in order, when the app next subscribes. An `opensApp`
  action starts the app with the tap in its intent instead (Android 12+ forbids opening an activity from a
  receiver). What a late tap means is the caller's decision (12B-2).
- **Framework APIs only** (`android.app.Notification.Builder`): no new Gradle dependency. The small icon
  is the `notification_icon` that `expo-notifications` already generates from `app.config.ts`.
- **Seam:** `apps/mobile/src/integrations/notifications/ongoing-notice.ts` validates every option (ids,
  `#RRGGBB`, at most three actions, finite times, a follow-up only after a countdown) before Kotlin,
  never throws, and is a no-op where the module is missing (`requireOptionalNativeModule`).

## Consequences

- The first native code in the app outside Expo's own modules. It is kept small and owned in the repo;
  every Android change to it needs a device walk.
- A new dev-client build is needed when it lands (a new native module).
- CLAUDE.md's platform note is about iOS Swift; this ADR is the explicit written exception for a small
  Android module, as the "fix the rule or write the ADR first" line requires.

## Alternatives considered

- **"Rest ends at 4:33" with a scheduled switch to the next set:** no native code, but not the approved
  design. Kept as the fallback if the module cannot be made reliable.
- **No Android card:** declined by the owner.
- **A third-party React Native notification library** (for example Notifee): a far larger native
  dependency than one chronometer call, and outside the Expo SDK 57 pin's tested set (ADR-027).
