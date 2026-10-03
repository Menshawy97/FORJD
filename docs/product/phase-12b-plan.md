# Phase 12B — a strength workout on the lock screen

**Status:** planned 2026-10-03, not started. Each slice is its own PR, test-first, reviewed, merged with
`main` green. The native slice also needs the owner's device walk before merge (ADR-063 decision 4).

## Owner decisions (2026-10-03)

1. **The same idea as the run notice, for workouts**, after the owner's Hevy example.
2. **The design is approved** (12B replica): header = the FORJD symbol, the workout name and the elapsed
   time;
   - **set card:** the exercise, `Set 3 of 4`, `82.5 kg × 6`, and an ember tick (Android: a **Done**
     action) that logs the set as done, as on the live screen;
   - **rest card:** `REST`, a **live, ticking countdown**, a progress bar, `Next · Bench Press · 82.5 kg × 6`,
     and **Skip** (Android: **Skip rest**);
   - when rest ends, the existing "Rest complete" buzz (ADR-026) still fires and the card switches back
     to the next set; tapping the card opens the workout.
3. **Android's countdown ticks live** through a small native module (ADR-063), not a fixed end time.
4. **iPhone:** the same card as a Live Activity (`expo-widgets`, ADR-062) with Phase 11.

## What exists today (read before changing it)

- `app/live.tsx` (the live session screen), `app/rest.tsx` (the rest screen), `app/set-timer.tsx`.
- `workouts/live-session.ts` (session state and events), `workouts/live-handoff.ts`,
  `workouts/rest-timer-card.tsx`, `workouts/rest-notifications.ts` (the rest-complete alert, ADR-026;
  since 12A-3 it uses the shared `installForegroundNotificationHandler` in
  `features/run/run-notification.ts`).
- The run notice (12A-3) is the pattern for content, the injected seam and the tests.

## Slices

### 12B-1 — The native module (Android, Kotlin)
- `npx create-expo-module@latest --local forjd-ongoing-notice` in `apps/mobile` (the generator, never
  hand-written boilerplate). Remove the generated web/iOS view stubs it does not need.
- Kotlin: `show(options)` builds a `NotificationCompat` notice: ongoing, `setOnlyAlertOnce(true)`, the
  FORJD small icon and ember colour, `setSubText`, and the chronometer
  (`setUsesChronometer` + `setChronometerCountDown(true)` + `setWhen(countDownToMs)`, or count-up from a
  start); its own low-importance channel; actions as `PendingIntent`s to a `BroadcastReceiver` that
  emits `onAction` to JavaScript, or, for an `opensApp` action, the launch intent with the action extra.
  `dismiss(id)` cancels it.
- JS seam: `src/integrations/notifications/ongoing-notice.ts` (typed wrapper, never throws, a no-op where
  the module is missing, e.g. Expo Go or iOS) + an injected fake for Jest. Conformance: the module only
  imported from `src/integrations/notifications/`.
- **Tests first:** the seam's argument shapes and fallbacks in Jest. The Kotlin itself is walked on a
  physical Android phone before merge: the countdown ticks with the screen off, Done and Skip work with
  the app in the background and after it was stopped, dismiss removes it, nothing re-alerts.

### 12B-2 — The workout notice
- Pure `workoutNoticeContent(session, nowMs)`: the set card or the rest card, exactly as approved, in
  the live screen's own formats (kg or lb per exercise), only training values (ADR-061).
- Wire into the live session: show when a session starts or a set changes; the rest card with
  `countDownToMs = restEndsAt` when rest starts; back to the next set when rest ends or is skipped;
  dismiss on finish or discard. Done → the same event as ticking the set on the live screen; Skip → the
  same as Skip Rest. Notification permission: the rest timer already asks at the first rest; reuse it.
- **Tests first:** content for each state, the transitions, the action routing, dismiss on every exit.

### 12B-3 — Docs and the device test
- FAQ wording proposed for approval (as 12A-4 did), `data-inventory.md` if anything new is stored,
  roadmap.
- **Owner's device test:** a real session with the phone locked: set → Done → rest ticks down → Skip or
  wait → next set; the rest-complete buzz still fires; finishing removes the notice.

### Later — iPhone Live Activity (with Phase 11)
The same card through `expo-widgets`, its own replica check first, an iPhone build (ADR-007).

## Risks
- Kotlin is new to this codebase: keep the module to one file of behaviour, and walk every change on a
  device.
- An action tapped after Android stopped the process: handled by opening the app with the action.
