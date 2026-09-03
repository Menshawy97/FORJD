# Phase 3J — showing a workout back to the athlete

Phase 3H made a workout runnable and 3I made it uploadable. Everything in J is the return
trip: the app has been able to *write* sessions since PR #85 and has never once been able to
*read* one back. Train, Home and the exercise-detail screen all render honest empty states
that are waiting on exactly that.

The ordered slice list lives in [`roadmap.md`](roadmap.md)'s "Immediate next steps". This
document carries the decisions each slice needed, so a later session does not have to
re-derive them.

## J-a — the session-list client (done)

`listWorkoutSessions` / `getWorkoutSession` in `apps/mobile/src/auth/apiClient.ts`, against
the two `GET` routes that have been live on `workout-sessions.controller.ts` since Phase E.

Two things worth keeping:

- **The list query type is written out in the client, not imported.** `WorkoutSessionListQuery`
  from `@forjd/contracts` is the schema's *output* type, where `limit` has already been
  defaulted and is therefore required. A caller sends the *input* side, where both fields are
  optional — and omitting `limit` is how the client asks for the server's own default rather
  than guessing at one. `WorkoutSessionListQueryInput` says that in the type system.
- **Landing it with a caller.** J-a on its own is a function nothing calls, which is precisely
  the failure mode that cost this project four separate features (`replaySessionState`,
  `drainSyncQueue`, the `session_queue` write, `library.tsx?pick=live`). It ships in the same
  PR as J-b, which calls both functions.

## J-b — Train's "Previous Workout" card

Built against `screenshots/train2.png` and the prototype's `s_train()` block.

### Two requests, not one

The list response is `workoutSessionSummarySchema` — id, name, activity, status, timestamps,
duration, effort. It carries **no exercises and no volume**, and the card needs both. So the
card reads `listWorkoutSessions({ limit: 1 })` for the most recent session, then
`getWorkoutSession(id)` for what was actually performed.

The alternative was widening the list contract with a volume total and an exercise digest.
Rejected for now: it puts a per-row aggregate on the hot path of a list that will grow to
hundreds of rows, to serve one card that only ever wants the first of them. If Home's stat
strip (J-c) or the history screen later needs the same figures for many rows at once, that is
the point to revisit it — and it would be an API change with its own migration, not a client
tweak.

### What the design shows that the data cannot support

The prototype's meta line reads `Yesterday · 45:12 · 14,200 kg · avg 151 bpm`, and the card
carries a `PR +` badge. Two of those are not shippable honestly:

- **`avg 151 bpm` is omitted.** No `HealthProvider` feeds this app yet. This is the same call
  already made for `workout-done.tsx`'s three HR tiles, and for the same reason: showing a
  fabricated number as an athlete's own training data is not acceptable. Unlike those tiles,
  this one is a fragment of a text line rather than a labelled slot, so there is nothing to
  leave an em dash in — it simply is not written.
- **The `PR +` badge is omitted.** A personal record is a claim about *all* history, and
  nothing on the device knows the athlete's best-ever set for an exercise. It returns with
  J-c/J-d, which is where the history data arrives.

The roadmap's own description of this slice — "name, `Yesterday · 45:12 · 14,200 kg`, the
exercise chips, and the `▶ Repeat` / `Summary` buttons" — already reflects both omissions.

### Chips

The prototype's chips are `Bench 82.5×6`, `Dips BW×12` — an exercise and its **heaviest
completed set**. Derived in `workouts/previous-workout.ts` (pure, no React), with names
resolved from the on-device catalogue (ADR-022) so the card works offline. A set logged with
no weight renders `BW`, as the prototype's own `Dips` chip does.

### The two buttons

- **`Repeat`** builds a `PendingLiveSession` from the session's own exercises and pushes
  `/live` — the same handoff `workout/[id].tsx`'s "Start workout" uses. It carries the previous
  session's `templateId` through, so a repeat of a template-based workout stays attributed to
  that template; the sets themselves start unticked, at what was performed last time.
- **`Summary`** reuses `workout-done.tsx` rather than adding a second summary screen.
  `CompletedSummary` gains an `origin` field for this: a `'live'` summary keeps the existing
  "logged offline, will sync when you are back online" line and kicks the sync queue, while a
  `'history'` summary does neither — that session is already on the server, and saying
  otherwise would be false.

## J-c / J-d / K — not started

Home's stat strip, "This week" and "Recent PR"; the exercise-detail stat tiles, sparkline and
history; then programs. `City Rank` remains the one Home counter Phase 3 does not supply
(open question 4 in `phase-3-plan.md`, still unanswered).
