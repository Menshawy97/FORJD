# ADR-049: Precise, foreground-only location for runs, kept on the device

**Status:** Accepted
**Date:** 2026-09-21
**Amends:** [ADR-048](ADR-048-coarse-location-for-leaderboards.md)

## Context

ADR-048 made location coarse, foreground and read once per workout, and its config blocks fine and
background location. That was right for city leaderboards, which need a city and nothing finer. A run
tracker is a different feature: it needs a continuous, accurate position to measure distance, pace,
splits and a route. The design (`live run 1.png`, `live run 2.png`, `run done.png`) shows exactly that,
and the "Start a run" tile has been inert since Phase 2 for want of it.

ADR-048 is not wrong; it answered a narrower question. This decision keeps everything it promised for
the leaderboard path and adds a separate, narrower exception for the run screen.

## Decision

1. **Precise location is used only while a run is open on screen, and only for a run.** The adapter
   (`apps/mobile/src/integrations/location/location-provider.ts`) gains `requestPrecisePermission` and
   `watchPrecisePosition`; it is still the only file that may import `expo-location` (ADR-048 #1).
   `ACCESS_FINE_LOCATION` is removed from `android.blockedPermissions`. Nothing else in the app reads a
   precise position.
2. **Foreground only.** `ACCESS_BACKGROUND_LOCATION` stays blocked, the plugin's background and
   foreground-service options stay off, and iOS "Always" stays off. The screen is kept awake while a run
   is open, so tracking continues with the phone in the hand or in an armband. Locking the phone pauses
   tracking; the run screen says so. A run that survives a lock or a crash resumes from its saved points
   (the same recovery approach as the strength runner, ADR-025).
3. **Permission is asked once, from the run screen,** the first time someone starts a run, with the
   reason stated. A denial leaves a clear message and an Open Settings action; it never blocks the rest
   of the app. Starting a run never waits on the network (CLAUDE.md rule 6): the run opens at once and the
   first fix arrives when it arrives.
4. **The route stays on the phone.** The points live in the device's SQLite database beside the run's
   recovery snapshot. What goes to the server is a summary: distance, moving time, elevation gain,
   splits, and, only with health-data consent, heart rate and calories (ADR-050). No coordinate of a
   route is uploaded, and no latitude or longitude column is added to the server, so ADR-048's
   "no latitude or longitude column exists anywhere" remains true.
5. **The leaderboard start position is unchanged.** A run still sends the same coarse, rounded start
   position as any workout, only if the leaderboard consent is on, and the server still resolves it to a
   city and discards it (ADR-045, ADR-048 #4 and #6). It is taken from the first accepted fix rounded to
   three decimals, never from the precise route.
6. **Copy is updated where it made the old promise.** The iOS when-in-use string, the Location screen,
   the Data sources page and `docs/architecture/security.md` no longer say location is only ever read
   once and coarsely; they say a precise position is used on the device while a run is open. The Play
   Data safety form must say the same, and is the user's to update.

## Consequences

- The app now asks for a second, stronger location permission, at a moment the person chose.
- Google Play and the App Store review precise-location use; the reason is stated in the permission
  text and the store forms, and no background access is requested, which is the part reviewers scrutinise.
- If background tracking is ever wanted (running with the screen off), it needs its own ADR, a
  foreground-service notification, and the store's background-location review. It is out of scope here.
- A test asserts the permission is requested only from the run entry point and never during a workout.
