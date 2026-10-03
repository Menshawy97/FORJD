# Phase 12A — a run keeps going with the screen off

**Status:** planned 2026-10-03. Owner decisions recorded in [ADR-059](../decisions/ADR-059-background-run-tracking.md)
(accepted, with its amendment). Each slice is its own PR, test-first, reviewed, merged with `main` green.

## Owner decisions (2026-10-03)

1. Background run tracking through a location foreground service, without
   `ACCESS_BACKGROUND_LOCATION` (ADR-059).
2. **Live numbers and buttons** in the notification, on **both** platforms. Android now; iPhone as a Live
   Activity with Phase 11 (Apple Developer account, ADR-007).
3. **The screen is no longer kept awake** during a run.

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
  `distanceInterval: 0`, `foregroundService: { notificationTitle: 'Run in progress', notificationBody:
  'FORJD is tracking your run. Tap to return.', killServiceOnDestroy: true }`),
  `stopRunLocationUpdates()`. The same lazy-require, never-throw rules as `location-provider.ts`.
- **Tests first:** mocked SDK: start passes exactly these options; stop is idempotent; fixes are
  validated (bad coordinates dropped) before reaching `onFixes`; a missing native module is reported
  `unavailable` instead of throwing.
- Conformance: `expo-task-manager` is allowed only under `integrations/`.
- `killServiceOnDestroy: true`: swiping the app away stops tracking; reopening offers the run back
  (crash recovery). That matches today and avoids a headless writer.

### 12A-2 — The run tracker owns the run (no UI change yet)
- `features/run/run-tracker.ts`: a module-level store holding the current `RunState` with
  `start/pause/resume/addFixes/finishRequested/subscribe/getState`. It persists the snapshot itself
  (every 10 s and on pause/resume, the existing G6 rules: closed before Finish waits).
- `useRunSession` reads from and commands the tracker instead of holding the state; the location source
  becomes `startRunLocationUpdates` instead of the foreground watch.
- **Removed:** the auto-pause on background, and `useKeepAwake` in `app/run.tsx` (owner decision 3).
  The "Paused when the phone locked" line goes (a visible change: covered by the replica gate below).
- **Tests first:** a fix arriving while no screen is subscribed still lands in the state and the
  snapshot; going to the background no longer pauses; Pause/Resume/Finish behave as today; existing
  `run.test.tsx` cases kept green.

### Gate — replica approval (before 12A-3)
The Android run notification (running and paused), what Finish from the notification does, and the run
screen without the lock-pause line, shown as a replica and approved by the owner.

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
