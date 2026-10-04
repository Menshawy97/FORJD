# Phase 12B — a strength workout on the lock screen

**Status:** 12B-1 and 12B-2 built 2026-10-03 (PRs #323 and the one stacked on it, both waiting for the owner's one device walk before merge); 12B-3 docs written, FAQ wording awaiting approval. Each slice is its own PR, test-first, reviewed, merged with
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

**Built (2026-10-03), as ADR-063's amendment records:**
- `modules/forjd-ongoing-notice/`: generated with `create-expo-module --local --platform android --features
  Function Event`, the web stub and the template licence removed. Kotlin in two files:
  `ForjdOngoingNoticeModule.kt` (the bridge and its records) and `OngoingNotices.kt` (posting, the
  countdown's follow-up alarm, the receiver, the pending-tap list). Framework APIs only, no new dependency.
- `show` also takes a `then` notice, posted by the module when the countdown ends (the countdown itself
  times out at zero), so the rest card turns into the next set with the app asleep. This is what makes the
  approved "card switches back to the next set" work without JavaScript.
- Taps made while the app was stopped are kept (ids only, at most 20) and handed over on the next
  subscribe; `opensApp` taps travel in the launch intent.
- Seam `src/integrations/notifications/ongoing-notice.ts` + 31 Jest tests; conformance rule + two fixture
  cases. `gradlew :forjd-ongoing-notice:compileDebugKotlin` passes locally (a throwaway prebuild).

**Review fixes (2026-10-03):** pending taps saved with `apply()` (the receiver runs on the main thread);
each PendingIntent carries its key as the intent identifier (Android 10+), so two notices' buttons can
never share one; a count-up that starts in the future is refused by the seam. Android lint could not run
locally (the app's native libraries fail on this machine's NDK); the module itself compiles.

**Also check on the device walk:** a rest that ends with the phone locked turns into the next set and
does not come back after being swiped away mid-rest; the small icon is the FORJD symbol, not a blank square.

**Device walk for 12B-1 (the owner, before merge):** needs 12B-2's wiring to see it in the app, so 12B-1 and
12B-2 are walked together on one dev-client build; 12B-1's PR waits for that walk.

### 12B-2 — The workout notice
- Pure `workoutNoticeContent(session, nowMs)`: the set card or the rest card, exactly as approved, in
  the live screen's own formats (kg or lb per exercise), only training values (ADR-061).
- Wire into the live session: show when a session starts or a set changes; the rest card with
  `countDownToMs = restEndsAt` when rest starts; back to the next set when rest ends or is skipped;
  dismiss on finish or discard. Done → the same event as ticking the set on the live screen; Skip → the
  same as Skip Rest. Notification permission: the rest timer already asks at the first rest; reuse it.
- **A tap that arrives late** (kept while the app was stopped) must be checked against the session before
  it acts: a Done for a set that is no longer the current one is dropped, never applied to the next set.
- **Tests first:** content for each state, the transitions, the action routing, dismiss on every exit.

**Built (2026-10-03), stacked on 12B-1:**
- `workouts/workout-notice-content.ts` (pure cards and the tap ids) and `workouts/workout-notice.ts` (the
  controller), 45 tests in `workouts/__tests__/workout-notice.test.ts`. `app/live.tsx` attaches the
  controller, syncs it on every session, pause and unit change, and starts each rest through it.
  `app/rest.tsx` no longer owns the rest: it follows the controller (ADR-026's amendment).
- Set card: exercise, `Set 3 of 4 · 82.5 kg × 6` in the live screen's own unit, Done, a count-up header.
  Rest card: `REST`, the native countdown, `Next · …`, Skip rest, with the next set as its `then`.
  Timed set: a `Start timer` button that opens the app. Paused: no ticking time, header says "Paused".
- **Late taps.** Button ids name the session and target. A Done for a set no longer open, a Skip for a
  rest that was adjusted or is over, any tap from another workout, and any Done after Finish are dropped.
  Taps kept while the app was stopped wait for the session to be restored, then pass the same checks;
  a Done that passes is logged with the time it is applied, not the time it was tapped.
- Dismissed on finish and on unmount (leaving the live screen), with the rest and its alert.
- Three reviewers (typescript, react, code) ran; every real finding was fixed or is listed below. `live.test.tsx` also fires a captured lock-screen Done through the real screen.

**Differences from the approved design, for the owner to confirm or reverse:**
1. **No progress bar on the rest card.** Android cannot move one without code running every few seconds
   (ADR-063 amendment). The countdown ticks natively; the bar would be frozen.
2. **The notification permission is asked at the start of the first workout**, not at the first rest,
   because the notice shows from set 1 (ADR-026 amendment).
3. **Leaving the live screen takes the notice down** (the plan said dismiss on unmount); the workout is
   offered back from Home as before.

**Owner's answers (2026-10-04) to the three differences:** (1) number only, no bar: confirmed. (2) Permission
at the start of the first workout: confirmed. (3) **Reversed: the card stays after leaving the live screen,
until the workout is finished.** Decided with the owner: it is removed after **3 hours with nothing logged**,
and its header time **keeps running** while away.

**12B-2b: the workout survives leaving the screen, with an in-app bar (owner-approved replica, 2026-10-04).**
The owner also asked, from the Hevy app, that pressing back from a running workout does not end it: a bar
floats above the tab bar (workout name, running time, current set, a trash button with an "Are you sure?"
step) and tapping it returns to the workout. Replica approved as drawn (running, resting, paused and
all-sets-done states; hidden on the workout, rest and set-timer screens). Plan, test-first:
1. **`workouts/active-workout.ts`: the live session moves out of `live.tsx`'s React state into a
   module-level store** that outlives the screen (start, restore from snapshot plus log, apply a change
   with the log written first, unlogged edits, discard, pause accounting, `isLogging`). `live.tsx` becomes
   a view over it; its 64 existing tests guard the behaviour. A workout is therefore alive until Finish
   or Discard, not until the screen unmounts.
2. **The notice controller follows the store** instead of being attached by the screen: every store change
   syncs the card; a lock-screen Done runs `completeSet` through `store.apply` (log first), with no
   navigation, so a rest started there is the controller's alone. Finish or discard dismisses everything.
   After **3 hours with nothing logged and the workout screen not open** the lock-screen card (not the
   workout) is removed. The 8 away-mode tests drafted for the earlier headless design are replaced by
   store-based ones.
3. **The bar** (`workouts/active-workout-bar.tsx`) is mounted once in the root layout over the router,
   above the tab bar on the tabs and above the bottom inset elsewhere; it reads the store, ticks once a
   second from wall-clock time, and opens `/live`. The trash asks, then discards: the snapshot and events
   are deleted, the notice and rest alert cancelled, nothing uploaded (new behaviour).
4. **Launch restore:** an unfinished snapshot is restored into the store when the app starts, so the bar
   (and the card) come back after Android killed the process; `/live` still restores on its own.
Known limit: the 3-hour removal needs JavaScript alive; after the process is killed the card stays until
the workout is reopened.

**Built (2026-10-04).** `workouts/active-workout.ts` (store, 29 tests), the notice controller reworked to
follow it (53 tests), `workouts/active-workout-bar.tsx` (21 tests), the root wiring (5 tests through the real
route tree) and `live.tsx` as a view over the store (67 tests). Differences from the replica, both because
the app's own design has no such glyph: the discard button is the app's own delete glyph (the `x` in the
destructive colour, as on the exercise screen), not a bin, and the paused tile uses the clock; the "are you
sure?" step is the exercise screen's own bottom sheet. Behaviour to know: a second workout cannot start
while one is running (the screen says "Finish or discard your current workout first."); a finished timed
set still opens no rest (as before); a lock-screen Done opens no screen.

**Known limits, to watch on the device walk:**
- A Skip rest tapped after Android killed the process cannot cancel the "Rest complete" alert (its id was
  lost with the process); the card goes back to the set and the alert still buzzes once.
- A lock-screen Done pushes `/rest` while the app is in the background; if the rest expires before the
  app is opened, the rest screen closes itself at once. Several lock-screen-only sets in a row are the
  case to try.
- A Done tapped while the app was fully stopped is only applied when the workout is next opened.
- Tapping the card body opens the app wherever it was; it does not yet deep-link to the workout.

**Owed phone tests (nothing here can be checked in CI or Jest):** the whole of 12B-1 and 12B-2 on a
physical Android phone, on one dev-client build, as listed under 12B-3 below. An emulator check was tried
on 2026-10-03 and could not be done: a local Android build fails on the owner's Windows laptop (the C++
step of `react-native-screens` and `react-native-worklets` makes ninja re-run CMake about 100 times and
give up, even from a clean cache; the emulator and the build together also exceed its 6.9 GB of RAM).
The owner's only phone is an OPPO A37f on Android 5.1.1, which the app cannot install on and whose
Android has no ticking countdown (needs Android 7.0 or newer). So the route is a cloud build (EAS, one
Expo login by the owner) installed on an Android 7+ phone, or on the emulator once a build exists. Until
then the emulator can still run the app from that build to check the buttons and the countdown; the real
lock screen, vibration and battery-saver behaviour still need a phone.

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
