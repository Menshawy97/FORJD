# ADR-048: Coarse location for city leaderboards: permissioned once, resolved on the server, never stored

**Status:** Accepted
**Date:** 2026-09-20

## Context

City leaderboards need to know which city a workout happened in. `docs/architecture/security.md`
already commits to the shape: location is captured only for an opted-in athlete, "when in use",
never in the background; it lives on the workout session and never on the user record; and it is
coarse. Until Phase 10 none of this was real: `apps/mobile/src/app/location.tsx` wrote the literal
string `'Alexandria'` to the profile, and `expo-location` was not installed.

## Decision

1. **`expo-location` sits behind one adapter**,
   `apps/mobile/src/integrations/location/location-provider.ts`, and only that file may import it
   (a conformance rule enforces it, CLAUDE.md rule 4). It loads lazily so a build without the native
   module (Expo Go) degrades to "unavailable" instead of crashing.
2. **Permission is requested in exactly one place**, `requestCoarsePermission`, called from the
   Location screen when the person taps "Allow Location". Reading a position
   (`readCoarsePosition`) only ever *checks* permission and never prompts, so nothing can raise a
   system dialog in the middle of a workout.
3. **Foreground only, low accuracy.** The Android build blocks fine and background location
   (`android.blockedPermissions`), so the manifest declares coarse location alone, and the iOS
   plugin's "Always" and motion purpose strings are switched off. A city needs neither.
4. **One position per workout, read at its start and never awaited.** After the person has allowed
   it once, each workout reads a coarse position when it starts, but only after the workout is
   already running (CLAUDE.md rule 6: the network, and here the GPS, is never in the critical path).
   The read has a 5 s timeout over the whole call, and answers "no position" rather than throwing.
   The position is rounded to three decimal places (about 110 m) before it leaves the adapter and
   is written into the crash-recovery snapshot once it arrives.
5. **Whether to read at all is decided on the device**, from a small local copy of the consent
   (`store/leaderboard-consent.ts`) with three states: yes, no, and "not known yet". The Location
   and Privacy screens keep it true, and so does Home, from the `GET /users/me` answer it already
   fetches every time it loads. A fresh sign-in starts at "not known", which Home resolves as soon
   as it loads; until then a workout simply reads no position. **A workout never asks the server
   itself:** a request from the live screen could, in a rare refresh failure, sign the person out in
   the middle of a set, which rule 6 forbids. The copy belongs to a sign-in: `clearSession` forgets it, and every
   way a session ends (log out, expiry, deletion) goes through `clearSession`, so a different
   account on the same phone never inherits the previous person's yes. (An earlier draft keyed it
   by user id; the sign-in responses do not carry one and nothing persists it, so that draft could
   never have switched on. `secureStorage.consent.test.ts` now drives the real sign-out and the
   real consent module, mocking only the two storage engines, so that cannot recur unnoticed.)
   The server remains the authority: a stale "yes" sends a coordinate that the server then ignores,
   and a stale "no" leaves a workout without a city until the person next opens either screen.
6. **The server resolves the city and discards the coordinates.** The upload carries
   `startLocation {latitude, longitude}`, never a city. `WorkoutSessionsService` derives the city
   with `CityResolverService` (ADR-045) only for an athlete who has opted in to both leaderboards
   and location, read live and never cached, and stores the city and its slug. **No latitude or
   longitude column exists anywhere.** An e2e test asserts that the stored row contains neither the
   coordinates nor any coordinate-shaped field.
7. **The client's own `city` and `citySlug` are deprecated and ignored.** The slug is the
   leaderboard key, so a client-chosen one would let anyone place themselves on any city's board.
   Rule 7 forbids removing them from a shipped `/api/v1` contract, so they are still accepted, not
   read, for one release.
8. **A failure to derive a city never loses the workout.** It degrades to "no city" and is logged
   without the position.

## Consequences

- **A session's city is fixed at its first upload.** Uploads are idempotent (first write wins), so
  a session whose derivation failed transiently (the consent read errored, or the city list was
  missing) keeps no city, and a retry does not fill it in. That is accepted; the `warn` log is the
  signal, and a persistent failure would show as every upload losing its city.
- **A session's city is a fact as of when it happened.** It is not re-resolved if the city list is
  later re-vendored.
- **A position that arrives after Finish is dropped.** The read never holds the workout up (up to
  5 s), so a very short workout may finish first and upload without a position, and so with no
  city. It is also not written back into the snapshot once Finish has cleared it, which would
  otherwise leave a stray snapshot for a workout already in the upload queue.
- **On-device retention.** The position lives in the crash-recovery snapshot until the workout
  finishes, and in the upload queue until it uploads. An upload that fails permanently keeps its
  payload, coordinates included, on the phone until the person retries it, signs out of the
  workout log, or deletes the account (`clearLocalUserData` wipes the database). It never leaves the
  device except to our own server.
- **The Location screen's copy changed.** The design said location is used "once during setup",
  which stopped being true; it now says a position is read when a workout starts and is never
  tracked in the background, so the app's claims match the store data-safety declarations.
- **`ACCESS_COARSE_LOCATION` only** must be confirmed on the first dev-client build with
  `aapt dump permissions`. `expo-location` cannot run in Expo Go, so a live test needs an EAS
  dev-client build, the same constraint as Google sign-in.
- The abandoned read is not cancellable (`expo-location` offers no cancel); one that times out keeps
  running until the OS settles it and its result is ignored.
