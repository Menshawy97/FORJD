# ADR-044: `isLiveTracked` means "run through the live workout runner"

**Status:** Accepted
**Date:** 2026-09-20

## Context

`docs/architecture/security.md` says only "live-tracked" sessions count toward a city leaderboard:
sessions with real start and end timestamps, never ones typed in or backdated afterwards. The
`workout_sessions.is_live_tracked` column was built for that (Phase 3), and its comment described it
as "streamed live to the server as it happened".

That is not what the app does, and cannot be. CLAUDE.md rule 6 says a workout works offline: the
runner logs every event on the device first (`session_events`, ADR-025) and uploads the finished
session afterwards from a sync queue. So the only writer of the flag, `toUploadRequest` in
`apps/mobile/src/workouts/live-session.ts`, hard-coded `false`, and a leaderboard that requires the
flag to be true would have ranked nobody.

## Decision

1. **`isLiveTracked` means the session was run through the live workout runner, with real start and
   end timestamps.** It does not mean streamed in real time. `toUploadRequest` now sends `true`,
   because every session the runner produces qualifies.
2. **What it proves:** the session came from the runner, whose timestamps come from the device
   clock at the moment of each action, as opposed to a form where someone types a date.
3. **What it does not prove:** nothing stops a modified client from posting a forged request body
   with `isLiveTracked: true`. This is a speed bump against casual gaming, not attestation. Device
   attestation is out of scope (see ADR-046 for what else limits abuse: per-session caps and the
   minimum city size).
4. **Existing rows stay `false`, and are never back-filled.** Sessions uploaded before Phase 10 were
   all sent as `false`, so they never rank. Changing them would make history that was not gathered
   under this rule count.
5. **The server stores what the client says** (the column and contract are unchanged), so no
   migration is needed and rule 7 (no breaking a shipped `/api/v1`) is respected.

## Consequences

- The schema docblock at `apps/api/src/database/schema/workouts.schema.ts`, the `toUploadRequest`
  docblock and the contract comments were rewritten to say this.
- Manually logged or imported workouts, if they are ever added, must send `false`. A future import
  path must not reuse `toUploadRequest`.
- If anti-cheat is ever strengthened (attestation, plausibility checks), it strengthens what this
  flag proves; it does not change what it means.
