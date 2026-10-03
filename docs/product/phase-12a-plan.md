# Phase 12A — a run keeps going with the screen off

**Status:** planned 2026-10-03. Owner decisions recorded in [ADR-059](../decisions/ADR-059-background-run-tracking.md)
(accepted, with its amendment). Each slice is its own PR, test-first, reviewed, merged with `main` green.

## Owner decisions (2026-10-03)

1. Background run tracking through a location foreground service, without
   `ACCESS_BACKGROUND_LOCATION` (ADR-059).
2. **Live numbers and buttons** in the notification, on **both** platforms. Android now; iPhone as a Live
   Activity with Phase 11 (Apple Developer account, ADR-007).
3. **The screen is no longer kept awake** during a run.
4. **Finish in the notification opens the app and finishes there**, showing the run summary, the same as
   Finish on the run screen.
5. **The design (replica v2) is approved**, modelled on the owner's Strava and Hevy lock-screen
   examples: the FORJD symbol in ember (`#E9712F`), the numbers in the run screen's own formats.
   - Android live notice: header `FORJD · Run` (`Run paused` when paused); title `24:31 · 4.82 km`;
     text `Avg pace 5:05 /km`; actions Pause (Resume when paused) and Finish.
   - Android fixed service notice: title `Location`, text `Tracking your run. Tap to return.`, grey,
     collapsed under the live one.
   - iPhone Live Activity (Phase 11): a black card, symbol and `Run` with a `LIVE`/`PAUSED` tag, three
     columns Time / Avg pace (/km) / Distance (km), Pause (Resume) and an ember Finish.
6. **The same idea for strength workouts** (owner, 2026-10-03): slice 12B, a lock-screen card with the
   current exercise, the set and the rest countdown and a done button, after the owner's Hevy example.
   **Its replica was approved on 2026-10-03:** header = symbol, workout name and elapsed time; a set
   card with the exercise, `Set 3 of 4`, `82.5 kg × 6` and an ember tick (Android: a Done action);
   a rest card with `REST`, the countdown, a progress bar, `Next · Bench Press · 82.5 kg × 6` and
   Skip (Android: Skip rest, the countdown drawn by Android's own chronometer so it stays exact with
   the screen off). Built in 12B after 12A; the iPhone Live Activity with Phase 11.

## What exists today (read before changing it)

- `integrations/location/location-provider.ts` is the only file that touches `expo-location` (conformance
  check). The run uses `watchPrecisePosition`, a foreground watch.
- `features/run/use-run-session.ts` owns the run: the reducer state (`live-run.ts`), the 10 s autosave of
  the crash-recovery snapshot (`run-snapshot.ts`, `store/run-session.ts`), auto-pause when the app goes to
  the background (`AppState` listener, "Paused when the phone locked"), Finish (one transaction since G6).
- `app/run.tsx` calls `useKeepAwake()`.
- `workouts/rest-notifications.ts` is the existing `expo-notifications` seam (ADR-026).

## The shape

With the screen off, React does not drive the run: `expo-location` delivers fixes to a **TaskManager task
defined at module scope**. So the fixes need one owner that works with or without the screen:

```
expo-location background task ──► runTracker (module-level store, features/run/run-tracker.ts)
                                      │  reduce fixes into RunState (live-run.ts, unchanged)
                                      │  persist snapshot (throttled)      ──► store/run-session.ts
                                      │  update the run notification (throttled) ──► integrations/notifications/run-notification.ts
                                      └► subscribers (useRunSession, when the screen is on)
notification actions (Pause / Resume / Finish) ──► runTracker commands
```

## Slices

### 12A-1 — Background location seam (no UI)
- Add `expo-task-manager` (SDK 57: `~57.0.21`) with `npx expo install`.
- `app.config.ts`: `isAndroidForegroundServiceEnabled: true`; background location stays **false** and
  blocked. iOS: `isIosBackgroundLocationEnabled: true` (When In Use only; `NSLocationAlways…` still
  deleted).
- `integrations/location/run-location-task.ts`: `defineRunLocationTask(onFixes)` (module scope,
  TaskManager), `startRunLocationUpdates()` (`Accuracy.BestForNavigation`, `timeInterval: 1000`,
  `distanceInterval: 0`, `foregroundService: { notificationTitle: 'Location', notificationBody:
  'Tracking your run. Tap to return.', killServiceOnDestroy: true }`), and the FORJD symbol as
  `androidForegroundServiceIcon`,
  `stopRunLocationUpdates()`. The same lazy-require, never-throw rules as `location-provider.ts`.
- **Tests first:** mocked SDK: start passes exactly these options; stop is idempotent; fixes are
  validated (bad coordinates dropped) before reaching `onFixes`; a missing native module is reported
  `unavailable` instead of throwing.
- Conformance: `expo-task-manager` is allowed only under `integrations/`.
- `killServiceOnDestroy: true`: swiping the app away stops tracking; reopening offers the run back
  (crash recovery). That matches today and avoids a headless writer.

### 12A-2 — The run screen tracks with the screen off — **as built**
- **Simpler than first planned: no separate tracker module.** With `killServiceOnDestroy`, the service
  stops when the app is swiped away, so whenever readings arrive the app's JavaScript and the run screen
  are alive. `useRunSession` keeps owning the run; `startTracking` replaces the foreground watch with
  `startRunLocationUpdates` + `setRunFixListener` (same start and recheck paths, same shape).
- `app/_layout.tsx` imports `run-location-task` so the task is defined at every bundle start (12A-1
  review: after a process restart only module-scope code runs).
- **Removed:** the auto-pause on background (and its `healthPromptOpenRef` guard), the "Paused when the
  phone locked" line, and `useKeepAwake` (owner decision 3).
- **Tests first:** locking keeps the run live with no message; readings that arrive while locked still
  count; keep-awake is not used; every existing run screen test moved from the watch to the service.
- The notification actions (12A-3) reach the hook through a small command channel, added there.

### Gate — replica approval (before 12A-3) — **approved 2026-10-03 (replica v2)**
The Android run notification (running and paused), what Finish from the notification does, and the run
screen without the lock-pause line. See owner decisions 4 and 5.

### 12A-3 — The live run notification (Android)
- `integrations/notifications/run-notification.ts`: a low-importance channel (no sound or vibration),
  one ongoing notification with a fixed id, updated at most every 5 s with time, distance and pace from
  a pure, unit-tested `runNotificationContent(state, nowMs)`; a category with Pause/Resume (handled
  without opening the app) and Finish (behaviour per the approved replica).
- Local only, so values are allowed (ADR-061 decision 3); lock-screen visibility follows ADR-061.
- Notification permission (Android 13+) is asked when the person starts their first run, never at
  launch; a refusal still tracks (Android then shows the service in its task manager instead).
- **Tests first:** content formatting (units, paused state), throttling, action routing to the tracker,
  no notification after Finish or Discard.

### 12A-4 — Docs and the device test
- FAQ (what the notification is and why), `data-inventory.md` (precise location now continues with the
  screen off, only during a run), the Play Data safety note, `live-run-plan.md` and the roadmap.
- **Owner's device test** (12A's exit criterion, cannot be done in CI): a 30-minute run with the phone
  locked in a pocket, on a physical Android phone, including battery saver; the distance matches the
  route; Pause/Resume/Finish from the notification work; swiping the app away stops tracking and the run
  is offered back. Needs a new dev-client build (new native dependency).

### Later — iPhone Live Activity (with Phase 11)
The same numbers and buttons as a Live Activity through `expo-widgets` (ADR-062), with its own replica
first. Needs the Apple Developer account and an iPhone build (ADR-007).

## Risks
- OEM battery killers (Samsung, Xiaomi) may still stop the service; the device test is the only check.
- Updating a notification every few seconds must not wake the screen or buzz: low importance, no sound,
  and throttled.
