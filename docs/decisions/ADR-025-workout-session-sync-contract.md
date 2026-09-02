# ADR-025: Workout session offline sync contract

**Status:** Accepted
**Date:** 2026-09-02

Settles the queue-semantics, retry/backoff, and deleted-exercise questions
`phase-3-plan.md`'s Phase F flags rather than deciding inline.

## Context

CLAUDE.md rule 6 requires the network is never in the critical path of a live workout
session. A session must be able to start, log every set, and finish entirely offline, then
upload once connectivity returns. Phase E already ships the server side of that upload
(`POST /workouts/sessions`, idempotent by the client-generated session `id`). Phase F builds
the device side: the append-only local event log `workout-engine.md` specifies (what makes
crash recovery real — a force-killed app rebuilds its session state by replay, not by trusting
whatever React state happened to survive), and the queue that holds a finished session until
it successfully uploads.

Three questions had no answer yet: what happens when a queued upload fails, how aggressively
it should retry, and what happens to a session whose referenced exercise was deleted on the
server in the meantime.

## Decision

### One `expo-sqlite` database, two tables, same seam ADR-022 established

`apps/mobile/src/store/workout-session.ts` opens its own database
(`forjd-workout-sessions.db`) — a separate file from the exercise catalogue's, because these
are two unrelated concerns with different lifecycles, not because SQLite disallows one
database per screen. Every function takes its `SqliteConnection` as an injected argument, the
same fixed shape ADR-022's `exercise-catalogue.ts` already defines and exports, reused here
rather than redeclared — the native module still cannot run under Jest, so this file is
exercised the same way, against a fake connection, in `workout-session.test.ts`.
`scripts/ci/check-architecture-conformance.sh`'s existing `expo-sqlite` pin is extended to
cover this file too.

- **`session_events`** — the append-only log. `(id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id, type, occurred_at, payload)`. Autoincrement order is replay order: this is a
  single-writer, single-device store, so there is no need for a separate sequence column or a
  wall-clock sort that a system-clock change could disturb.
- **`session_queue`** — one row per finished, not-yet-synced session:
  `(session_id PRIMARY KEY, payload, status, attempt_count, next_retry_at, last_error)`.
  `payload` is the exact `WorkoutSessionUploadRequest` JSON that will be POSTed — built once,
  when the session finishes, and never rebuilt from a later read of the event log. A retry
  resends this same payload, carrying the same `id`, which is what makes Phase E's
  idempotency actually take effect: the queue's job is to keep resending an unchanged
  request, not to keep re-deriving one.

### A session enters the queue only once, on `workout_finished`

No other event type builds or updates a queue row. `phase-3-plan.md`'s own architecture
constraint — "no PATCH/DELETE, a session uploads once, complete" — is enforced here on the
producing end: there is nothing in this file that could enqueue a partial or in-progress
session even by mistake, because the only code path that calls `enqueueSessionUpload` is the
one that observes a `workout_finished` event.

### Replay is a pure function over the event log plus the session's own `startedAt`

`replaySessionState(startedAt, events)` folds the ordered log into
`{ status, durationSeconds, completedSetKeys }`. `durationSeconds` is elapsed time **minus**
every `workout_paused` → `workout_resumed` interval, matching `WorkoutSession.durationSeconds`'s
own domain contract ("excluding paused stretches... not simply `endedAt - startedAt`"). There
is no `workout_started` event in `WORKOUT_EVENT_TYPES` — session start is a fact the caller
already has (it is the moment the session row itself is created, before any event exists), so
replay takes it as a parameter rather than inferring it from the first log entry, which would
break the moment a session's very first logged action was a pause.

### Retry is exponential backoff with a cap, then a terminal `failed` state — never an infinite loop

`drainSyncQueue` skips any row whose `next_retry_at` has not passed, so it is safe to call on
every reconnect or app-foreground event without a separate scheduler. On failure, `attempt_count`
increments and `next_retry_at` is set to `now + min(30 min, 1s * 2^attempt_count)`. After 5
failed attempts a row moves to `status: 'failed'` and `drainSyncQueue` stops touching it
automatically.

**A `failed` row is not deleted.** Its event log is kept too. Losing a workout because its
upload failed five times would be a worse outcome than a stale local row; the recovery path
for a `failed` session — surfacing it to the user with a manual retry, most likely from a
workout-history screen — is UI work for a later phase (whichever phase first reads
`session_queue` for display), not invented here ahead of a screen that would use it.

### A session whose exercise was deleted server-side fails permanently, by design, not by omission

The open question `phase-3-plan.md` posed: does a soft-deleted referenced exercise's row
"still exist, so the reference resolves" cover this, or does it need a fallback. The answer
settled here is **no automatic fallback** — `WorkoutSessionsService.upload` (Phase E) checks
*visibility* (`findManyVisibleForUser`, which excludes soft-deleted rows), not mere row
existence, because a template creating a *new* prescription against a deleted exercise should
be rejected the same way. A session recording something that already happened does not get a
different, more lenient check purely because it arrived late — retrofitting one now, for a
rare edge case with no screen yet to explain it to a user, is exactly the kind of
speculative-generality YAGNI warns against. Concretely: such a session's upload keeps
returning 400, `attempt_count` climbs, and it lands in the same `failed` state as any other
permanently-broken upload, surfaced the same way. If this proves to be a real, frequent
problem once users are actually deleting custom exercises with pending offline history, that
is grounds for a follow-up ADR loosening the check specifically for the session path — not a
speculative fix now.

## Consequences

- Every consumer of `session_queue`/`session_events` must go through this file's functions;
  nothing else in the app is allowed to import `expo-sqlite` (enforced in CI).
- `drainSyncQueue` takes its upload function as a parameter, the same injection
  `syncExerciseCatalogue` uses for `fetchCatalogue` — so it never imports the API client
  directly and stays testable with a fake that can simulate a rejected upload without a real
  HTTP call or a running server.
- Nothing here decides *when* `drainSyncQueue` is called (on `NetInfo` reconnect, on app
  foreground, on a timer) — that wiring is a screen/navigation concern for whichever phase
  first has a live-session or history screen to hang it from, matching how `openExerciseCatalogueDb`
  is the one line ADR-022 leaves for a device walk rather than Jest to prove.
- `workout-engine.md` names Drift as the local database; this ADR is also where that stale
  fact gets corrected in the doc itself, since ADR-013 and ADR-022 already superseded it in
  practice and this is the first place session storage actually lands in code.
