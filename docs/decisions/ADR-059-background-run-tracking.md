# ADR-059: A run keeps tracking with the screen off, through a location foreground service

**Status:** Proposed (2026-10-03), awaiting the owner's decision. Nothing is built on it yet.
**Date:** 2026-10-03
**Would supersede:** [ADR-049](ADR-049-precise-foreground-location-for-runs.md) decision 2 ("Foreground only").
**Plan:** roadmap Phase 12, decision 1 and slice 12A; drafted under G7 of
[engineering-gaps-plan.md](../product/engineering-gaps-plan.md).

## Context

ADR-049 made location foreground only: the run pauses itself when the phone locks and says why. That
was the right first step, but a runner pockets the phone, so it is the likeliest beta complaint (roadmap
Phase 12). The question is how to keep GPS running with the screen off **without**
`ACCESS_BACKGROUND_LOCATION` ("Allow all the time"), which Play reviews separately and which the app has
never needed.

Android treats location read by a **foreground service of type `location`, started while the app is
visible**, as foreground access: the person sees an ongoing notification, and only "While using the
app" permission is required. iOS has the equivalent: the `location` background mode with When In Use
permission, shown as the blue status-bar pill, never "Always".

## Evidence (spike, 2026-10-03)

Checked against the installed `expo-location` 57.0.20 (the SDK 57 pin, ADR-027), not assumed:

- **The config plugin** (`plugin/build/withLocation.js`): with `isAndroidBackgroundLocationEnabled: false`
  and `isAndroidForegroundServiceEnabled: true` it adds exactly `FOREGROUND_SERVICE` and
  `FOREGROUND_SERVICE_LOCATION`. Background location is added only by the background flag.
- **The library's own manifest** declares `LocationTaskService` with
  `android:foregroundServiceType="location"` and asks only for coarse and fine location.
- **A real `expo prebuild --platform android`** with the foreground service switched on produced:
  - `ACCESS_BACKGROUND_LOCATION` with `tools:node="remove"`, because `app.config.ts` still blocks it, so
    the manifest merger strips it even if a library asked for it;
  - `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION`, the only new permissions.
- `expo-task-manager` 57.0.21 is on npm for SDK 57; `startLocationUpdatesAsync` needs it for the task.

Not yet proven, and only a phone can: that updates keep arriving with the screen off under Doze and
battery saver, including on Samsung and Xiaomi battery killers (12A's exit criterion).

## Decision (proposed)

1. **Android:** while a run is open, `Location.startLocationUpdatesAsync` runs with `foregroundService`
   set (an ongoing notification showing time, distance and pace, with Pause and Finish). It is started
   only from the visible run screen and stopped on Finish or Discard.
2. **`ACCESS_BACKGROUND_LOCATION` stays blocked** in `app.config.ts`. Only `FOREGROUND_SERVICE` and
   `FOREGROUND_SERVICE_LOCATION` are added. CI or a release check confirms that with
   `aapt dump permissions` (Phase 12 exit criterion).
3. **iOS (Phase 11):** `UIBackgroundModes: location` with When In Use only; `NSLocationAlways…` stays
   deleted, as it is today.
4. **Everything else in ADR-049 stands:** precise location only while a run is open, the route never
   leaves the phone, the leaderboard still uses a coarse position.
5. The location task writes fixes into the same run engine and crash-recovery snapshot, so a killed
   service recovers as a killed app does today (R5).
6. **Native code sits behind an injected seam**, as ADR-026 did for notifications, so Jest covers the
   run logic. All `expo-location` calls stay in `apps/mobile/src/integrations/location/` (conformance
   check).

## Consequences

- The Play Data safety form and the privacy policy say "precise location, while a run is open,
  including with the screen off", and the FAQ explains the notification.
- Keep-awake becomes optional on the run screen.
- 12A cannot be called done from CI: it needs the 30-minute locked-phone test on a physical Android phone.

## Alternatives considered

- **Background location ("Allow all the time").** Rejected: a broader permission than the job needs, a
  separate Play review, and a scarier prompt.
- **Keep the screen on.** Today's behaviour. Drains the battery and fails when the phone is pocketed.
