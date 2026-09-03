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

## J-c — Home's counters, and the `/workouts/sessions/stats` endpoint

Home needs six figures: lifetime workouts, this month, City Rank, a week streak, "This week"'s
seven day bars, and "Recent PR". **None of them can be served by the session list**, which is
cursor-paginated with no totals and carries no sets. So J-c adds an endpoint rather than
deriving them on the device.

### Why an endpoint rather than client-side derivation

This was put to the user as an explicit choice, and they chose the endpoint. The alternative —
fetching a page of sessions and counting — is honest only for "This week" and "This Month". The
lifetime count and the streak need the whole history, and a personal record needs every *set* of
every session, which would mean walking the entire history on every Home render. Computing it in
Postgres, next to the data, is one request that stays correct as history grows.

This is the revisit J-b's own note anticipated when it declined to widen the list contract.

### The time zone is a parameter, and that is the point

Every figure here is a **local calendar** concept — which month, which week, which weekday — and
the server has no idea what calendar the device is on. Without an explicit zone, "this month"
silently means "this month in UTC": wrong for most of the world for part of every day, and wrong
about *which day a workout happened on* for anyone far enough from Greenwich.

`workoutStatsQuerySchema` validates the zone against `Intl` rather than a hardcoded list, which
would go stale with every IANA release. The validation is not cosmetic: the value reaches a
`date_trunc(... at time zone $1)`, and Postgres *raises* on a name it does not know — so an
unvalidated typo would be a 500 rather than a 400.

Inside the repository, each session's timestamp is resolved to a local `YYYY-MM-DD` in SQL, and
every calculation after that is **civil-date arithmetic on a UTC ruler**. That is what stops a
daylight-saving transition from making one week 167 hours long and shifting every weekday index
inside it by one.

### Definitions worth not re-deriving

- **Counts are of completed sessions only.** An in-progress or cancelled session is not a workout
  the athlete did, and counting one inflates every figure on Home at once.
- **The streak tolerates an empty current week.** Measured on a Monday morning, a streak that
  required *this* week would reset every week before the athlete had a chance to train. It falls
  to zero only once the previous week is empty too.
- **"Recent PR" is the most recently *set* record, not the heaviest lift ever.** An athlete who
  set a squat PR last week should see that, not the heavier deadlift they have held for a year.
  Each exercise's best weight is dated to the **first** time it was reached — repeating a lift
  does not re-set the record, and dating it to the latest repeat would make the card change for
  no reason — and the most recent of those wins.
- **Weighted sets carrying both a weight and a rep count only.** There is no honest way to rank a
  timed hold against a lift, and "100 kg × —" is worse than reporting the next-best set that has
  both halves.

### The route-ordering trap

`@Get("stats")` is declared **above** `@Get(":id")` in `workout-sessions.controller.ts` and must
stay there. Nest matches routes in declaration order, so the other way round
`/workouts/sessions/stats` binds to `getById` with `id: "stats"`, fails its UUID guard, and 404s
on every request Home makes — with nothing in either method looking wrong. An e2e test asserts a
200 on that path for exactly this reason.

**City Rank remains unsupplied.** It needs the leaderboard behind the Rank tab, which is still a
placeholder — open question 4 in `phase-3-plan.md`, still unanswered. It keeps its em dash.

### The mobile half

`getWorkoutStats()` joins Home's existing `Promise.allSettled`, so a stats request that fails
cannot empty the sections the other three requests fill. Its result is held as one nullable
piece of state, and **`null` renders exactly the empty state a brand new account sees** — which
is the honest reading whether the request has not resolved, has failed, or the athlete really
has never trained. Home is the launch screen; it must never look broken.

The three components each took a prop and nothing more, which is what the Phase 2 decision to
build all eight sections at full fidelity with honest empty values was *for*.

Two things worth keeping:

- **The device sends its own zone.** `Intl` is probed rather than assumed, because Hermes ships
  a trimmed ICU; a runtime that cannot answer falls back to `UTC`, matching the server's own
  default, so the athlete sees figures bucketed by UTC days rather than no figures at all.
- **"This week" supplies two of the design's three bar states**, trained and rest. "Partial"
  needs a planned week to fall short of, which arrives with programs (Phase 3K) — inventing it
  now would mean inventing the target it is partial against.

**A missing mock is not a rejected promise.** Four sibling suites render Home and mock
`@/auth/apiClient`; adding a call without adding it to their mocks throws a `TypeError` *before*
`Promise.allSettled` is called, which no amount of settling absorbs. Targeted runs did not catch
it — the full suite did, which is the fourth time that has been the difference.

## J-d / K — not started

The exercise-detail stat tiles, sparkline and history; then programs.
