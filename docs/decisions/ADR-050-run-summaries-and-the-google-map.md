# ADR-050: Run summaries on the server, the route on the phone, and a Google map with a fallback

**Status:** Accepted
**Date:** 2026-09-21

## Context

A finished run needs to be stored, shown in history, and counted on the leaderboard, and its screen
wants a map. Four things have to be decided together: what shape a run takes on the server, how it
reaches the existing leaderboard and volume pipelines, what happens to heart-rate data, and where map
tiles come from.

## Decision

1. **A run is a workout session with a summary.** It uploads as an ordinary `WorkoutSession` with
   `activity: 'running'`, `isLiveTracked: true` (ADR-044), and exactly one completed set of a curated
   "Outdoor Run" exercise carrying `distanceMeters` and `durationSeconds`. The leaderboard's kilometres
   and time inputs (ADR-046) read those sets already, so runs count with no scoring change.
2. **The extra detail is an additive optional `run` object on the upload contract**, valid only when
   `activity` is `running`: `distanceMeters`, `movingSeconds`, `elevationGainMeters`, `avgHeartRateBpm`,
   `caloriesKcal`, `caloriesSource` (`watch` or `estimate`) and up to 200 `splits`
   `{ index, distanceMeters, durationSeconds, avgHeartRateBpm }`. Adding an optional field to a shipped
   `/api/v1` request is not a breaking change (CLAUDE.md rule 7). Two tables hold it,
   `workout_run_summaries` and `workout_run_splits`, deleted with the session, added by a drizzle-kit
   migration (rule 14).
3. **Heart rate and calories are health data and follow ADR-043.** They are stored only when the
   person's health-data consent is on. When it is off the service stores the run without them and
   answers success, because an upload comes from the offline queue and must never fail and lose a
   finished run. The device keeps them either way and shows them on the summary screen.
4. **Calories are the watch's value when there is one, otherwise an ACSM estimate,** labelled
   "estimated" (formulas and citation in `docs/product/live-run-plan.md` and the FAQ). No weight on
   record means no estimate. It is a plain calculation, never called AI (ADR-030).
5. **The map is Google's, through `react-native-maps`,** because the user chose street context over the
   drawn-route alternative. It lives in `apps/mobile/src/integrations/maps/`, the only place allowed to
   import it (a conformance rule, CLAUDE.md rule 4). With no key configured, or where the native module
   is absent (Expo Go, web), the same component draws the designed striped background with the route
   over it, so the screen works and can be tested without a key.
6. **The Maps key is public by design and restricted.** It is a client key, embedded in the app binary
   by the config plugin; the protection is a restriction to the app's package name and signing SHA-1 in
   the Google Cloud console, not secrecy, the same argument ADR-041 #6 makes for the Google client ID.
   It is supplied as an EAS environment variable and never committed. It is the user's to create.
7. **Privacy trade-off, stated plainly.** Drawing street tiles means Google's SDK receives the area
   being viewed. That is why the map is only on the run screens, why the route itself is never sent to
   Google (it is drawn on top by our code), and why the FAQ says so.

## Consequences

- Runs appear in leaderboards, volume totals and "previous workout" without new scoring rules; the
  previous-workout line shows kilometres for a run instead of "0 kg".
- The upload schema, the service and the two tables gain tests; a request with `run` on a non-running
  activity is rejected as a contract error.
- Without a Google Cloud billing account nothing breaks: the map falls back, and only the street layer
  is missing.
- The Health Connect part (watch heart rate and calories during a run) reuses the unverified
  `HealthConnectProvider` and cannot merge until run on a physical Android phone (rule 16, ADR-035).
