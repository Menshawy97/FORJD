# Phase 12C — finished workouts and runs upload by themselves

**Status (2026-10-04): built, in review; device walk owed.** One slice, one PR, test-first,
reviewed, merged with `main` green. There is no custom native code (Expo's own module wraps Android's
WorkManager), but it needs a new dev-client build, and a device walk is owed (no Android 7+ phone
yet, same as 12A/12B).

## Owner decisions (2026-10-04)

1. **Workouts and runs only.** Body scans (InBody) are *not* queued: a scan is read by a paid AI call
   while the athlete watches, and nothing is saved on the phone for later (`store/pending-scan.ts` is
   deliberately in-memory). The roadmap's "sessions, runs, InBody" is corrected to match. A scan queue
   is a separate, later decision (it needs double-charge protection).
2. **About every 15 minutes**, whenever Android allows and there is internet. 15 minutes is Android's
   shortest gap; Android may wait longer to save battery. That is a hint, not a promise.

## What exists today

- `workouts/sync-sessions.ts` → `syncPendingSessions()` drains the SQLite `session_queue` (finished
  workouts **and** runs share it) through `drainSyncQueue` (ADR-025: backoff, `MAX_ATTEMPTS`, 4xx =
  failed, retry-after-network). It is silent, safe to call often, and only sends the signed-in
  account's rows.
- Triggers today are all foreground: app launch, returning to the app, finishing a workout, finishing
  a run, the Home screen. A finished run or workout therefore waits until the athlete reopens the app.
- Uploads are idempotent on the server (the session id), and the store increments attempts atomically
  in SQL, so a background drain overlapping a foreground drain cannot double-count.
- `expo-task-manager` is already a dependency (the 12A location task). `expo-background-task` is not.

## The slice — 12C-1: a background drain

**Dependency:** `expo-background-task` on the SDK 57 line (`~57.0.21`), added with `npx expo install`
(never hand-edited). Native, so a new dev-client / EAS build is required.

**Seam (CLAUDE.md rule 4):** `apps/mobile/src/integrations/background/background-upload.ts` is the only
file that imports `expo-background-task`. It follows the `run-location-task.ts` pattern: native modules
`require`d lazily so a build without them (Expo Go) reports `unavailable` instead of crashing, and
nothing throws into the caller.

- `BACKGROUND_UPLOAD_TASK = 'forjd-background-upload'`.
- The task body is injected (`defineBackgroundUpload(drain)`), so tests drive it with a fake and the
  seam never imports `workouts/`; `_layout.tsx` (module scope) wires `syncPendingSessions` in. The
  task runs the drain and returns `Success`, or `Failed` if the drain itself threw. A queue row the
  server rejected is *not* a task failure (the queue already tracks it).
- `registerBackgroundUpload()`: registers with `minimumInterval: 15` (minutes) once signed in;
  idempotent; reports `registered | unavailable | restricted`. Never prompts, never throws.
- `unregisterBackgroundUpload()`: on sign-out. The drain already sends only the signed-in account's
  rows, and with no token sends nothing, so this is tidiness, not safety.
- The seam reads and logs nothing about workouts; the drain stays in `workouts/`.

**Wiring:** the task is **defined by the app's entry file**, not a route file. expo-router loads route
modules lazily, so a headless wake-up (no screen) would never evaluate `_layout.tsx`, and TaskManager
unregisters a task it finds undefined (found in review). `apps/mobile/index.ts` (now `package.json`
`main`) imports `src/background-task.ts` first, then `expo-router/entry`. `_layout.tsx` only registers
when `authenticated` and unregisters when not. Register and unregister run in order, so a quick
sign-in then sign-out cannot leave the task registered. Checked with a real Metro export.

**Conformance:** `scripts/ci/check-architecture-conformance.sh` gets one new check, `expo-background-task`
imported outside `apps/mobile/src/integrations/background/`, beside the `expo-task-manager` check.

**Rule 6 / privacy:** the task never touches a live workout and is never on its critical path; it only
sends what is already saved on the phone, to FORJD's own API. No analytics SDK (rule 15).

## Tests (written first, shown red)

1. Task body: runs the drain; returns Success; returns Failed when the drain throws; a drain that
   *reports* failed rows still returns Success.
2. Register: calls `registerTaskAsync` with the task name and a 15-minute interval; a second call does
   not register again; the `unavailable` and `restricted` paths do not throw.
3. Unregister: unregisters when registered; no-op when not.
4. Missing native module: every function reports `unavailable` and never throws.
5. `_layout` registers once signed in and not while signed out (extends the existing layout tests).
6. The conformance script flags a stray `expo-background-task` import (checked by hand and recorded
   in the PR, unless the script has a self-test).

## Not in this slice

- Body-scan queueing; health-data background sync; push or local notifications (12D-12F).
- A visible setting. There is no new screen, so no mock-up is needed. If the owner wants an
  "uploaded in the background" line or a toggle, that is new UI and gets a replica first.

## Owed on a device (carry into the beta walk, with 12A/12B)

Finish a workout in airplane mode, turn the network on, lock the phone, wait about 15-30 minutes, and
check it appears on the server without opening the app. Repeat for a run. Try battery-saver and an OEM
battery manager (Samsung, Xiaomi): background work may be delayed or skipped there, which is
expected, and the foreground triggers stay the guaranteed path.

## Docs to update when built

Done: the roadmap's Phase 12 table (12C row) and ADR-025 (an amendment: one more trigger, same retry
policy). No `docs/architecture/` page describes the sync trigger, so none needs changing.

## Device walk: also check

Swipe the app away from recents (not a force stop), finish nothing new, and confirm a queued workout
still uploads at the next background run: this proves the task is defined when Android wakes the app
without a screen. In a debug build, `triggerTaskWorkerForTestingAsync` runs the task on demand.
