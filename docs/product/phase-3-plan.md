# Phase 3 — the workout engine: plan

## Context

The workout engine is the third of CLAUDE.md's four architecturally-critical pillars, and the
first of them that does not exist yet. Two are already built (the canonical health model, the
provider abstraction); the fourth (longitudinal analytics) is downstream of this one, because
there is nothing to analyse until sessions are being recorded.

Its design is already written and is **not** re-decided here:
[`../architecture/workout-engine.md`](../architecture/workout-engine.md) specifies the
template/session split, the extensible block types and the offline-first execution model, and
[`../architecture/domain-model.md`](../architecture/domain-model.md) (lines 55–58) already
names the tables. This document is the *execution* plan — the slices, in the order they can
actually be built, with what each one delivers and how it is verified. It mirrors the shape of
[`nutrition-plan.md`](nutrition-plan.md), which is the most recent capability this repo built
end to end and the closest available template.

**Design source of truth for the screens**, in the standing precedence order — screenshots
first, then the prototype, then specs, and the frozen `design_handoff_forjd_mobile/` bundle
last (it is marked "do not build from it"):

- Screenshots: `live workout.png`, `live workout 2.png`, `live run 1.png`/`2.png`,
  `workout done.png`, `workout done 2.png`, `workout custom.png`, `workout history.png`,
  `train1.png`/`train2.png`, `program.png`, `custom program1.png`/`2.png`,
  `favourite workouts and programs.png`.
- Prototype: `FORJD mobile app design/FORJD Mobile.dc.html` — `s_live()`, `s_rest()`,
  `s_builder()`, `s_workoutDetail()`, `s_programBuilder()`, `s_setTimer()`.
- Specs: `../design/phase2-screen-specs.md` (every Phase-2 deferral this phase must now fill —
  the library's `builder`/`live` pick modes, exercise-detail stat tiles and history, "Start a
  run") and `../design/design-revision-screen-specs.md` line 23 (`setTimer`, "pure client
  state, Phase 3").

## Starting position

**Nothing named `WorkoutTemplate`, `WorkoutSession` or `WorkoutBlock` exists in code.** A
repo-wide search finds only prose comments referring to them as future work. This is a
greenfield vertical, exactly as nutrition was.

What *does* transfer, and should be reused rather than rediscovered:

- **The exercises library (Phase 2) is the substrate.** `packages/domain/src/exercise-vocabulary.ts`,
  `apps/api/src/database/schema/exercises.schema.ts`, the repository/service/controller trio in
  `apps/api/src/exercises/`, and the mobile screens `library.tsx` / `exercise/[id].tsx`.
  `exercises.schema.ts`'s own docblock says it soft-deletes *because* "Phase 3's workout
  sessions will reference exercises by id" — that decision was made for this phase.
- **`Exercise.measure` (`weight | time | distance`) decides how a set is logged.** It already
  exists and is the discriminator the set model needs; do not invent a second one.
- **ADR-022 (exercise catalogue sync) is the offline precedent to extend.** The full catalogue
  already syncs to on-device SQLite behind a function seam, version-gated by a SHA-256 content
  hash, with every function taking an injected `SqliteConnection` because expo-sqlite's native
  module cannot run under Jest. That ADR was written *for* this phase: rule 6 means a session
  must start and run with no network, which means the exercises must already be local.
- **The vertical-slice shape.** Migration → `packages/domain` vocabulary → `packages/contracts`
  zod schemas + pinned fixtures → repository → service → controller → unit + e2e tests →
  expo-router screen. The repository never distinguishes "no such row" from "not yours"
  (returns `null`/`false`); the service turns that into **404, never 403**.
- **The mobile idioms.** `apps/mobile/src/auth/apiClient.ts` (one typed async function per
  endpoint over axios — there is no React Query in this app), `auth/failure.ts` for the
  offline/unauthorized taxonomy, `useFocusEffect` + one `setState` commit per load,
  NativeWind classNames plus `src/theme/tokens.ts` for raw SVG colours.
- **Home is already waiting for this data.** `apps/mobile/src/features/home/stat-strip.tsx`,
  `this-week.tsx` and `recent-pr.tsx` render honest empty values today; each becomes a prop.
  `start-workout-cta.tsx` implements only the fallback branch of the prototype's
  `goSuggested`; its active-program branch belongs to this phase's programs slice.

**Next migration number is `0012`** (`apps/api/drizzle/` currently ends at
`0011_add-saved-meal-name-unique-and-group-name.sql`).

## Locked decisions

Made during this planning pass, from the architecture docs and existing precedent.
**Do not re-litigate without a new ADR.**

| Decision | Reasoning |
|---|---|
| **Template and session are separate tables, from the first migration** | `workout-engine.md` is explicit that this split "exists from Phase 3 (the walking skeleton), not added later". A template says `Squat 4×8 @ 100kg`; the session says `100×8, 100×8, 100×7, 95×8`. Overwriting one with the other destroys the only signal progression analytics has. |
| **`workout_blocks` carries a `type` from day one** | Straight sets, superset, interval, AMRAP, time-based. Only straight sets is *implemented* first, but the column and the domain tuple carry all five, so HYROX/running/Pilates arrive as content, not as a schema migration. |
| **Block/set types are `text` + a domain tuple, never a PG enum** | Exactly what `exercises.schema.ts` and `nutrition.schema.ts` already do; adding a value to a PG enum is a migration, adding one to a tuple is not. |
| **The local store is `expo-sqlite`, not Drift** | `workout-engine.md` still says Drift — a leftover from ADR-001 (Flutter), superseded by ADR-013 (Expo RN). ADR-022 already ships `expo-sqlite` behind a function seam. **Fix that doc as part of this phase.** |
| **The local session is an append-only event log** | `SetCompleted`, `RestStarted`, `RestCompleted`, `ExerciseCompleted`, `WorkoutPaused`, `WorkoutResumed`, `WorkoutFinished`. This is what makes crash recovery real: the app can be killed mid-session and the state rebuilt by replay. A mutable "current session" row cannot do that. |
| **Local write is the source of truth during a session; sync happens after** | CLAUDE.md rule 6. The network is never in the critical path. No screen in the live flow shows a spinner waiting on a request. |
| **Sync is idempotent by a client-generated key** | Each session gets a UUID at creation, on the device, and the upload is keyed by it. A retried upload after a dropped response must not create a second session. The server returns the existing session for a duplicate key rather than an error the client has to interpret. |
| **Weights are stored canonically in kg** | ADR-016: `weightUnit` is a display preset. The wire and the database use one unit; the screen converts. Storing what the user typed makes every later aggregate wrong. |
| **Templates are owner-scoped with a nullable owner** | The same shape as `exercises`: `ownerUserId IS NULL` means a catalogue/system template, non-null means the user's own. This is what lets a curated program ship later without a second table. |
| **Soft delete, never hard delete** | A session references a template and an exercise by id; a hard delete either orphans the reference or rewrites someone's training history. |
| **Programs come last, not first** | A program is a schedule *over* templates. Building it before templates and sessions exist means building against nothing. It is the final slice, and it is what completes Home's "Start Workout" active-program branch. |
| **No new mobile state library** | `useState` + `useFocusEffect` + the SQLite seam, as everywhere else. The live session's state is local to the live screen and its event log, not a global store. |

## Build order

**Phase A — domain vocabulary.** `packages/domain/src/workout-vocabulary.ts`: the `as const`
tuples and display-name maps for block types, set types, session status and the local event
names, plus the canonical `WorkoutTemplate` / `WorkoutBlock` / `WorkoutSession` / `WorkoutSet`
interfaces. Pure TypeScript, zero imports — CI's conformance check enforces that. Re-exported
from `packages/domain/src/index.ts`.
**Testing**: `workout-vocabulary.spec.ts` pinning every tuple's membership and the display-name
map's totality (the same shape `exercise-vocabulary.spec.ts` already uses).

**Phase B — schema and migration `0012`.** `apps/api/src/database/schema/workouts.schema.ts`,
generated with `pnpm --filter @forjd/api db:generate` — never hand-edited, never applied
through the Supabase Studio UI (CLAUDE.md rule 14). Both halves of the split land together
because the session tables' foreign keys point at the template tables:
`workout_templates → workout_blocks → workout_exercises`, and
`workout_sessions → workout_session_exercises → workout_sets`. Owner-scoped with RLS as
defence in depth, with the real authorization in the NestJS guard (rule 12).
**Testing**: apply to local Postgres and assert the constraint behaviour the schema claims —
soft-deleted rows stay referenceable, a session survives its template's deletion.

**Phase C — contracts.** `packages/contracts/src/index.ts`: zod schemas built *from* the Phase A
tuples via `z.enum(...)`, so drift between domain and wire is unrepresentable. Request and
response shapes for template CRUD and for a session upload, plus pinned fixtures in
`fixtures.ts` written out by `scripts/write-fixtures.ts`.
**Testing**: `workouts.spec.ts` pinning every deliberate decision — that a set's weight is kg,
that an unknown block type is rejected, that a session upload carries its idempotency key.

**Phase D — templates API.** `apps/api/src/workouts/` — module, controller, service,
repository, mirroring `ExercisesModule` exactly. `@UseGuards(JwtAuthGuard)` at class level;
`ZodValidationPipe` on every body and query; 404-never-403 in the service. Register in
`app.module.ts` and add the per-file coverage thresholds to `apps/api/package.json`.
**Testing**: repository and service unit suites, plus `workouts.e2e-spec.ts` over real HTTP and
real Postgres — including that one user cannot read or mutate another's template.

**Phase E — sessions API.** `POST /workouts/sessions` accepting a completed session with its
client-generated idempotency key, and the list/detail reads that Home's counters and history
will use. Replaying the same key returns the existing session rather than creating a second.
**Testing**: e2e proof that a double upload produces one row, and that a session's stored
values are the ones performed, never back-filled from its template.

**Phase F — the offline layer.** `apps/mobile/src/store/workout-session.ts`: the append-only
event log in `expo-sqlite` and the sync queue that drains on reconnect, both behind the same
injected-`SqliteConnection` function seam ADR-022 established, so they are testable under Jest.
A new conformance rule in `scripts/ci/check-architecture-conformance.sh` pinning the module.
**Write ADR-025** here — the session sync contract is a real decision (queue semantics,
retry/backoff, what happens to a session whose exercise was deleted server-side) and belongs in
an ADR, not only in this plan.
**Testing**: crash recovery — replay a partial event log and assert the rebuilt session state;
a queued session that fails to upload stays queued and uploads once, not twice.

**Phase G — the builder screen.** `s_builder()` / `s_workoutDetail()`. Fills the
`library.tsx?pick=workout` deferral `phase2-screen-specs.md` recorded.

**Phase H — live execution.** `s_live()` plus `s_rest()` (90s default, auto-pushed when a set is
ticked) and `setTimer`. This is the screen rule 6 exists for: it reads the local catalogue,
writes to the local event log, and makes no network call at all.
**Testing**: the offline path explicitly — with every API function mocked to reject, a full
session can still be started, logged and finished.

**Phase I — the summary screen.** `workout done`, and the write that hands the session to the
sync queue.

**Phase J — wire up what is already waiting.** Home's stat strip counters, "This week" and
"Recent PR" swap their honest empty values for real data; Train's "Previous workouts" and "My
workouts" replace their placeholder line; `exercise/[id].tsx` gets the stat tiles and history
`phase2-screen-specs.md` deferred. Update those screens' existing tests, which currently pin
the empty states on purpose.

**Phase K — programs.** `programs → program_weeks → program_days`, plus enrollment that
snapshots `program_version` so updating a program's content never rewrites someone's in-flight
12-week cycle. Completes Home's `goSuggested` active-program branch and `s_programBuilder()`.

## Verification

Per phase, and again before each merge:

```bash
TZ=UTC pnpm --filter @forjd/mobile test --ci --watchAll=false
```

plus `pnpm typecheck`, `pnpm lint`, `pnpm conformance`, the API unit and e2e suites
(`--runInBand` — a documented flake otherwise), and a **real bundle compile**
(`npx expo export --platform android`), because Jest does not compile NativeWind or native
modules and a green suite is not proof the app builds.

`TZ=UTC` is not optional on the mobile suite.

**Device walk** (handed over, not waited on): the live-session flow must be walked on a
physical Android device with airplane mode on — start a session, log sets, take a rest, kill
the app mid-session, reopen it and confirm the session resumes, then re-enable the network and
confirm exactly one session syncs.

## Open questions

1. **Does a rest timer need to survive backgrounding?** A phone locks between sets. If the
   timer must fire a notification, that is `expo-notifications` and a permissions prompt —
   decide before Phase H, because it changes the rest screen's design.
2. **What happens to a queued session whose exercise was deleted server-side?** Soft delete
   means the row still exists, so the reference resolves — confirm that is enough, or define
   the fallback. Settle in ADR-025 (Phase F).
3. **Are curated templates seeded in this phase or left empty?** The owner-nullable column
   supports them either way; seeding is a separate ingest job like `exercises:load`.
4. **Does "City Rank" (Home) come from this phase or from the Rank tab's own work?** It is the
   one Home counter this phase does not obviously supply.

## Related

- [`../architecture/workout-engine.md`](../architecture/workout-engine.md) — the design this
  plan executes. **Contains one stale fact to fix in Phase F: it names Drift as the local
  database, which ADR-013 and ADR-022 superseded with `expo-sqlite`.**
- [`../architecture/domain-model.md`](../architecture/domain-model.md) — the table plan.
- [`../decisions/ADR-022-exercise-catalogue-sync.md`](../decisions/ADR-022-exercise-catalogue-sync.md)
  — the offline precedent this phase extends.
- [`nutrition-plan.md`](nutrition-plan.md) — the plan whose structure this one copies.
- **Housekeeping**: `ADR-017` is referenced by name in `exercises.schema.ts`,
  `exercise-vocabulary.ts` and `nutrition-plan.md`, but **no `ADR-017-*.md` file exists**.
  Either write it or correct the references while working in these files.
