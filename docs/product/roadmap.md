# Roadmap

Full phase-by-phase plan, decisions, and risk register:
`C:\Users\Mostafa Ashraf\.claude\plans\c-users-mostafa-ashraf-downloads-forjd-sleepy-hammock.md`

This file is a living summary kept in sync with that plan as phases
complete or get re-planned — the plan file is the detailed source, this is
the quick-reference for "what phase are we in and what's next."

## Current status (last updated 2026-09-02)

**Phases 0–2 are complete. Phase 2.5 (nutrition) is complete** — Phases A through J are done,
and **Phase I (the "Nutrition Today" card) shipped as part of the Home dashboard**, exactly as
`nutrition-plan.md` said it should if Home were built first. See
[`nutrition-plan.md`](nutrition-plan.md) for the full build history. Also shipped in that
stretch, outside the original phase list: **ADR-024** (image compression — `sharp`
server-side, `expo-image-manipulator` client-side, WebP/512px/quality-80) and four Phase H bug
fixes found on a real device.

**The Home dashboard is built.** `apps/mobile/src/app/(tabs)/index.tsx` is no longer
`<PlaceholderScreen name="Home" />`. All eight sections of the design's Home screen render at
full visual fidelity, but **only the Nutrition Today card has a backend today** — readiness
and the four health metrics are gated on Phase 6 (Health Connect / HealthKit), and the workout
counters, "This week" and "Recent PR" are gated on Phase 3 (the workout engine). The decision
taken, and the thing to preserve when those phases land, is **honest empty values**: zero
counters, em dashes for unknowns, and copy explaining what will fill them — never the design's
demo numbers (147 workouts, an 87 readiness score, a 100 kg bench PR), which would be
fabricated claims about a user's own health and training. Each section is its own component
under `apps/mobile/src/features/home/`, so lighting one up is a prop change, not a rewrite.
"Start Workout" implements the prototype's `goSuggested` fallback branch (no active program ⇒
the Train tab); the active-program branch arrives with Phase 3's programs slice.

**Phase 3 (the workout engine — one of CLAUDE.md's four architecturally-critical pillars) is
underway.** Its plan lives at [`phase-3-plan.md`](phase-3-plan.md).

**Phase A (domain vocabulary) is done**:
[`packages/domain/src/workout-vocabulary.ts`](../../packages/domain/src/workout-vocabulary.ts)
carries the five `as const` tuples (block types, set types, session statuses, perceived
efforts, local event names) with display-name maps, plus the canonical `WorkoutTemplate` /
`WorkoutBlock` / `WorkoutExercise` / `WorkoutSession` / `WorkoutSessionExercise` / `WorkoutSet`
/ `WorkoutSessionEvent` interfaces, re-exported from `index.ts`. Written test-first
(`workout-vocabulary.spec.ts`, confirmed RED before the implementation existed), mirroring
`exercise-vocabulary.spec.ts`'s coverage/orphan-key pattern.

**Phase B (schema and migration `0012`) is done**:
[`apps/api/src/database/schema/workouts.schema.ts`](../../apps/api/src/database/schema/workouts.schema.ts)
defines both halves from the domain-model doc —
`workout_templates -> workout_blocks -> workout_exercises` and
`workout_sessions -> workout_session_exercises -> workout_sets` — landed together in one
migration, generated with `pnpm --filter @forjd/api db:generate` (never hand-edited).
`workout_sessions.id` deliberately has no `defaultRandom()`: it is client-generated at session
start and doubles as the sync idempotency key (Phase E). FK actions follow existing precedent
(`exerciseId` is `onDelete: restrict`, mirroring `nutrition_log_entries.food_id`; a session's
`templateId` is `onDelete: set null` so a hard-deleted template never deletes or orphans the
sessions performed against it). RLS is not enabled, matching `exercises.schema.ts` and
`nutrition.schema.ts` — no client holds a Supabase credential (ADR-008), so the gating rule is
not tripped; authorization is a Phase D/E NestJS-guard concern. Constraint behaviour is pinned
against real Postgres in `workouts.schema.spec.ts` (soft-deleted exercises stay referenceable,
hard-deleting a still-referenced exercise is rejected, a session survives its template's
hard-deletion, cascades clean up session children, `based_on_template_id` nulls out on its
base template's deletion).

**Phase C (contracts) is done**: `packages/contracts/src/index.ts` builds
`workoutBlockTypeSchema` / `workoutSetTypeSchema` / `workoutSessionStatusSchema` /
`perceivedEffortSchema` via `z.enum(...)` straight from the Phase A tuples, plus request
schemas for template CRUD (`createWorkoutTemplateRequestSchema`,
`updateWorkoutTemplateRequestSchema`) and detail/list response schemas
(`workoutTemplateResponseSchema`, `workoutTemplateListResponseSchema`) and for session upload
(`workoutSessionUploadRequestSchema`, `workoutSessionResponseSchema`,
`workoutSessionListResponseSchema`). Three deliberate omissions, each mirroring an existing
precedent: **`orderIndex` is never a client field** — position is the array's own index, the
same choice `createSavedMealRequestSchema.items` makes. **`basedOnTemplateId` is
service-derived**, never client-supplied, the same division `createExerciseRequestSchema`
draws around `goal`. **A session-exercise's `measure` is never client-supplied** — the server
snapshots it from the `exercises` row it looks up by `exerciseId`, never trusting a
client-declared copy of a fact the server already owns. Weight and distance are bare numbers
(kg and metres, fixed by contract, never a co-travelling unit field). Pinned in
`workouts.spec.ts` (22 tests) and four new fixtures in `fixtures.ts`
(`workout-template-response`, `workout-template-list-response`, `workout-session-response`,
`workout-session-list-response`).

**Phase D (templates API) is done**: `apps/api/src/workouts/` (`workouts.module.ts`,
`workouts.controller.ts`, `workouts.service.ts`, `workouts.repository.ts`,
`workout-cursor.ts`) mirrors `ExercisesModule` exactly — `@UseGuards(JwtAuthGuard)` at class
level, `ZodValidationPipe` on every body/query, 404-never-403 in the service, `(name, id)`
keyset pagination. `ExercisesModule` now exports `ExercisesRepository` (its own docblock
anticipated this), and gained `findVisibleIds` — one bulk query `WorkoutsService` uses to
reject a template referencing an exercise the caller cannot see (catalogue, own custom, not
soft-deleted), returning a 400 rather than letting a forged UUID reach the database.
`WorkoutsRepository.createTemplate`/`updateTemplate` batch-insert a template's whole
block/exercise tree in two queries per write (not one insert per row), matched back to their
input by `orderIndex` rather than assumed `RETURNING` order. An update with `blocks` present
deletes the existing tree (cascade) and inserts fresh, matching the contract's own "the
builder screen re-saves the whole workout" decision. `basedOnTemplateId` is always `null` on
create — the "customise this preset" flow that sets it is Phase G's, not invented early.
Registered in `app.module.ts`; `workouts.service.ts` and `workout-cursor.ts` added to
`apps/api/package.json`'s 100%-coverage list. `workouts.e2e-spec.ts` proves cross-user
isolation over real HTTP (404-never-403 on read/update/delete of another user's template, and
exclusion from their list).

**Phase E (sessions API) is done**: `POST /workouts/sessions` (`WorkoutSessionsController` /
`WorkoutSessionsService`, in the same `WorkoutsModule`, sharing `WorkoutsRepository`) accepts
a completed session keyed by its client-generated `id`. `WorkoutsRepository.upsertSession` is
idempotent by that id: `onConflictDoNothing` on the primary key, and a replayed upload returns
the *first* write's row untouched — the retry's own payload (a different `name`,
`durationSeconds`, etc.) is discarded entirely, which is the whole point of an idempotency key.
A replayed id belonging to a *different* user is a genuine collision, not a retry —
`ConflictException` (409), mirroring `ExercisesRepository`'s own unique-violation handling.
Every referenced exercise must exist and be visible (`ExercisesRepository.findManyVisibleForUser`,
one bulk query, also returning each exercise's `measure` so the service snapshots it
server-side rather than trusting the client's request); an optional `templateId` must resolve
via `WorkoutsRepository.findByIdForUser` before it is accepted. Both failures are 400s on the
request body, not 404s naming a session that does not exist yet. The sessions list orders
`(startedAt, id)` **descending** (newest-first, unlike the templates list's alphabetical
order) with its own cursor shape in `workout-cursor.ts` (`WorkoutSessionCursor`). No
`PATCH`/`DELETE` — a session uploads once, complete, after it finishes on-device (rule 6).
`workout-sessions.service.ts` added to the 100%-coverage list. `workout-sessions.e2e-spec.ts`
proves idempotency over real HTTP (a retried upload with a mutated payload still produces one
row, with the original values) and that a session's performed values are never back-filled
from its template's prescription.

**Phase F (the offline layer) is done**: `apps/mobile/src/store/workout-session.ts` — the
append-only `session_events` log and the `session_queue` sync table, in their own
`forjd-workout-sessions.db`, behind the same injected-`SqliteConnection` seam ADR-022
established (reused from `exercise-catalogue.ts`, not redeclared). `replaySessionState(startedAt,
events)` is a pure fold over the event log that rebuilds `{ status, durationSeconds,
completedSetKeys }` — `durationSeconds` excludes every `workout_paused`→`workout_resumed`
interval, matching `WorkoutSession.durationSeconds`'s own domain contract. `drainSyncQueue`
takes its upload function injected (mirroring `syncExerciseCatalogue`'s `fetchCatalogue`
param), skips a row whose `next_retry_at` hasn't passed or whose `status` is already
`failed`, and on success removes the row and clears its event log so it can never upload
twice. **ADR-025** locks the decisions the plan flagged as open: exponential backoff (1s→30min
cap) to a terminal `failed` state after 5 attempts (never an infinite retry loop, row and log
both kept rather than deleted); and — the deleted-exercise question — **no special-cased
fallback**: a session referencing an exercise soft-deleted server-side keeps failing the same
`findManyVisibleForUser` check a template would, landing in the same terminal `failed` state,
because loosening the check for sessions specifically would be speculative generality with no
screen yet to explain a `failed` upload to a user. `workout-engine.md`'s stale "Drift" local-db
reference is corrected to `expo-sqlite`, citing ADR-013/ADR-022/ADR-025.
`scripts/ci/check-architecture-conformance.sh`'s `expo-sqlite` pin now covers this file too.
`workout-session.test.ts` proves crash recovery (partial logs replayed across simulated
app-kill/reopen boundaries) and the queue's idempotent-retry-until-success and
give-up-after-max-attempts behavior.

**Nothing yet reads or writes this store from a screen** — Phase G (the builder) and Phase H
(live execution) are what actually call `appendSessionEvent`/`enqueueSessionUpload`/
`drainSyncQueue`; this phase only ships the store itself, matching how `exercise-catalogue.ts`
shipped in Phase H of the exercise-library plan before Phase I's screens consumed it.

**Phase G (the builder screen) is done**: `apps/mobile/src/app/builder.tsx` (`s_builder()`,
matched against `workout custom.png`) and `apps/mobile/src/app/workout/[id].tsx`
(`s_workoutDetail()` — no reference screenshot exists for this one, so the prototype source
is authoritative per the standing precedence order) — the first screens calling the Phase D
template API. `library.tsx`'s `pick=builder` deferral is filled: picking a row calls
`setPickedExerciseForBuilder` then `router.back()`, returning to the exact same builder
instance (`apps/mobile/src/workouts/builder-handoff.ts`, a plain in-memory module, not a new
state library, since expo-router has no built-in way for a picker to return a result). Train's
header gained the screenshot's own orange "+" button as the one minimal entry point to
`/builder` — the "My Workouts" list itself stays Phase J's job.

**Two real design/contract revisions surfaced while building against the actual prototype,
both confirmed with the user rather than assumed:** (1) `basedOnTemplateId` on
`POST /workouts/templates` is now client-supplied and server-validated (`findByIdForUser`),
reversing Phase D's original "fully derived" design — the prototype's `Customise` flow copies
a source template's data into the builder's local state and only the final edited result is
ever saved, so the create request is the only place that relationship can attach; this mirrors
the precedent already shipped for `WorkoutSessionUploadRequest.templateId`. `workoutTemplateSummarySchema`
also gained `basedOnTemplateId`, needed to derive the design's three-way Preset/Customised-preset/Custom
badge (`isCustom` alone only distinguishes two of three). (2) Exercise names for the detail
screen and the Customise prefill are resolved from the on-device exercise catalogue
(`getCachedExercise`, ADR-022) rather than added to the workout response — the catalogue
already owns that data, offline and with no extra round trip.

Builder only creates (`POST`), never `PATCH`es — the prototype has no in-place edit
affordance; every visit either starts from scratch or copies-then-saves-as-new via Customise.
"Start workout"/"Start now" render inert (Phase H, not built yet), matching the established
"render the card, route it nowhere yet" precedent.

Verified: contracts (86 tests), api (34 suites / 584 unit tests + 108 e2e tests, `--runInBand`,
coverage thresholds hold), mobile (`typecheck`/`lint` clean; `builder-handoff.test.ts` — 4/4).
Given this session's severe context/cost pressure by this point, full RTL component tests for
`builder.tsx`/`workout/[id].tsx` were deferred rather than written now — a real gap to close
in a follow-up, not a silent omission. `pnpm -r build` and
`scripts/ci/check-architecture-conformance.sh` both clean.

**Phase G device walk (physical iPhone, Expo Go) found and fixed three real bugs, all in a
follow-up PR:**

1. **Wrong badge colour/style.** `builder.tsx` and `workout/[id].tsx` each hand-rolled the
   Preset/Custom/Customised-preset badge as a solid orange fill for every kind. The prototype's
   own `typeChip(t)` helper (`FORJD Mobile.dc.html`) renders an *outlined* pill
   (`rgba(255,255,255,.05)` fill, `1px solid <color>44` border) whose colour depends on the
   kind — grey for Preset, accent orange for Custom, and **green** (`typeChip`'s `else`
   branch) for Customised preset, never orange. Extracted into a shared
   `apps/mobile/src/components/type-chip.tsx` (`TypeChip`) so both screens share one
   correct implementation, with a unit test pinning the colour mapping.
2. **Uneven card padding.** The exercises card's outer container used a uniform `py-[4px]`;
   the prototype's own `this.card([...], {padding:'4px 15px 15px'})` call is deliberately
   asymmetric (4px top, 15px bottom) — the visible gap under "Add exercise" was always
   smaller than the gap above it, regardless of how many exercises were added, because the
   button's own `mt-[12px]` compounded with a too-small container bottom padding. Fixed by
   matching the prototype's exact top/bottom split.
3. **Save failures showed a generic, unhelpful message.** `builder.tsx` never called
   `actionableServerMessage` (`apps/mobile/src/auth/failure.ts`) on a save failure, unlike
   `signup.tsx` — any 400 response (e.g. `WorkoutsService`'s "Unknown exercise id(s)" check)
   collapsed into "Could not save this workout. Please try again." regardless of the real
   reason. Fixed to match the established pattern, though this turned out not to be the
   user's actual bug (see below).

**The user's real save failure: the local API dev server was stale, not restarted since
before the Workouts feature's routes existed.** A direct e2e reproduction of the exact
reported payload against `WorkoutsService.create()` in-process succeeded with a clean `201`,
which ruled out the request shape, exercise-visibility checks, and duplicate exercises — but
in-process tests boot a fresh Nest application from the current compiled classes every time,
so they could never have caught this. The actual long-running `node dist/main` process the
phone's requests were hitting (PID confirmed via `Get-Process` to have started at 8:56 AM that
day) had been started *before* the Workouts feature was ever wired into `AppModule`, so every
`/workouts/templates` route hard-404'd — confirmed directly with a real Supabase-issued token
(minted via the Admin API to bypass the also-active email rate limit) curled straight at the
running server, independent of anything the phone or the mobile client code was doing. Logging
out, back in, and even creating a brand-new account never could have fixed it, because the
route simply did not exist on the process being asked. Fixed by restarting the API under
`start:dev` (`nest start --watch`) instead of the one-off `node dist/main` it had been running
under, so future code changes are picked up automatically instead of silently going stale.
While diagnosing this, an unrelated e2e-test hygiene issue surfaced — the workouts e2e suite
leaks real fixture rows (an exercise and two users, name/email-prefixed
`1788351445707-vaetus`) into the shared local dev database with no teardown, and one of those
rows had already synced into the reporting user's on-device exercise catalogue, briefly
confusing the diagnosis with a garbled exercise name — spun off as its own follow-up rather
than fixed under this session's time pressure (see the spawned task "Fix workouts e2e suite
leaking fixture data into dev DB"). The `apiClient.ts` interceptor's session-refresh-failure
messaging gap found and discarded as a hypothesis along the way is still real, independent of
this bug, and is now fixed (see immediately below).

**The "unauthorized falls through to a generic message" gap (above) is now fixed, app-wide,
without touching any of the dozen screens.** Tracing `AuthGate` in `_layout.tsx` showed the
redirect to `/welcome` already happens automatically on any forced `clearSession()` — the
actual gap was that nothing told the user *why*. `secureStorage.ts` now exposes a one-shot
`clearSession({ expired: true })` / `consumeSessionExpired()` pair; `apiClient.ts`'s
interceptor sets it on a failed-refresh clear (never on `profile.tsx`'s manual logout); and
`welcome.tsx` shows "Your session expired. Please log in again." above its CTAs when it reads
true. See ADR-011's addendum for the full design. Tests: `secureStorage.test.ts`,
`apiClient.test.ts`, and a new `welcome-session-expired.test.tsx`; 18 existing test files'
`secureStorage` mocks were mechanically updated to include the new export. Full mobile suite
(63 suites / 371 tests) and `tsc --noEmit` both green; `code-reviewer` agent returned APPROVE
with 0 blocking issues.

Read this section first when resuming — it says exactly what's done and what to do next.
Don't re-derive this from scratch; verify it's still accurate and continue.

### Immediate next steps (as of 2026-09-03)

**Phase 3H and 3I are code-complete and merged.** A workout can now be started, logged entirely
offline, finished, recovered after a crash, and uploaded. PRs #79–#85.

| Slice | What landed |
|---|---|
| H1 | `workouts/live-session.ts` — the pure session reducer (no React, no SQLite, no network) |
| H2/H3 | `live.tsx`, `rest.tsx`, `set-timer.tsx` |
| H4 | Rest notifications via `expo-notifications` — [ADR-026](../decisions/ADR-026-rest-timer-notifications.md) |
| H5 | The two entry points, plus `library.tsx?pick=live` |
| H6 | Crash recovery — `session_snapshot` + `restoreSession` |
| I | `workout-done.tsx`, the queue handoff, and `workouts/sync-sessions.ts` |

**Four things that were silently broken and are now fixed** — worth knowing because each was
"exists and is tested but nothing calls it":

- `replaySessionState` had no caller, so a force-kill lost the workout entirely.
- `drainSyncQueue` had no caller, so a finished session never uploaded.
- Finishing a workout never wrote to `session_queue`, despite the store's docblock claiming it
  happened automatically on `workout_finished`. That docblock was wrong and is corrected.
- The live screen's `Add exercise` routed to `library.tsx?pick=live`, which the library ignored
  — tapping a row abandoned the workout in progress.

**What to do next, in order:**

1. **Finish the device walk. Partly done — the notification now fires (2026-09-03).**

   **Verified on a physical iPhone:** locking the screen during a rest delivers the
   "Rest complete" notification. It took two attempts. The first walk found the feature
   **completely silent**, and the cause is worth remembering because no test could have caught
   it: `expo-notifications` 0.32 requires every object trigger to name a
   `SchedulableTriggerInputTypes` value, the code passed a bare `{ seconds }` — which schedules
   nothing, silently — and **an `as unknown as` cast in the scheduler seam had silenced the
   compile error that would have flagged it.** Fixed in PR #89, with the ADR-026 addendum
   carrying the general lesson: *a seam that exists to make a native module testable must still
   be typed against that module's real interface, or a compile-time error becomes a runtime
   silence only a device can observe.*

   **Still to walk**, all of it now worth doing because each path could previously only fail:
   - **Skip a rest early** and confirm *no* notification arrives (the cancel path).
   - **Force-kill mid-session, reopen** and confirm the session resumes with its ticked sets,
     paused state and elapsed time (PR #83 — this had no caller at all before).
   - **Airplane mode**: log a whole session offline, finish, then re-enable the network and
     confirm exactly **one** session syncs (PRs #84/#85).
   - **Android**: the notification channel, importance and vibration have been reasoned about
     but never run.
2. **Phase J — wire up what is already waiting. Partly done (PR #87).** Train's **My Workouts**
   now lists real templates, which finally gives a saved workout somewhere to be seen. What is
   **still** placeholder or empty, in the order worth doing:

   **a. The mobile session-list client does not exist.** `GET /workouts/sessions` and
   `GET /workouts/sessions/:id` are both live on the API (`workout-sessions.controller.ts`), but
   `apps/mobile/src/auth/apiClient.ts` has no function calling them — the same shape of gap as
   `uploadWorkoutSession`, which was missing until PR #85. **Everything below is blocked on
   this**, so add `listWorkoutSessions` / `getWorkoutSession` first.

   **b. Train's "Previous Workout" card** (`train2.png`) — name, `Yesterday · 45:12 · 14,200 kg`,
   the exercise chips, and the `▶ Repeat` / `Summary` buttons. `Repeat` starts a new session from
   that session's exercises; `Summary` opens the finished-workout screen.

   **c. Home's stat strip, "This week" and "Recent PR"**
   (`features/home/stat-strip.tsx`, `this-week.tsx`, `recent-pr.tsx`) — each already renders an
   honest empty value and takes the shape of a prop, by design. **"City Rank" is the one counter
   Phase 3 does not supply** (open question 4, still unanswered).

   **d. `exercise/[id].tsx`'s stat tiles, sparkline and history** — deliberately shipped as
   honest empty states in Phase 2J, waiting on exactly this data.

   **Update the existing tests rather than adding around them**: several suites pin the empty
   states *on purpose* (`home-fidelity.test.tsx`, `exercise-detail-fidelity.test.tsx`), and
   `screen-atmosphere.test.tsx` anchors on per-screen text — that one broke when Train stopped
   saying "coming soon", and CI caught it rather than the targeted runs.
3. **Phase K — programs.** The final Phase 3 slice.
4. **Smaller known gaps**, all recorded at the end of
   [`phase-3h-plan.md`](phase-3h-plan.md): abandoned sessions leak `session_events` rows, and
   the per-exercise goal chip renders its chevron but opens no picker.
5. **The workouts e2e fixture teardown** still leaks rows into the shared dev DB (spun off
   during Phase G, never started).

**Standing environment note.** The local API dev server crashed **four times** in one session
under `npm run start:dev`; the Nest watcher exits with `The process NNNNN not found` when its
child is already gone, and does so **while still appearing to run**. That is the same shape as
the Phase G incident. Check `netstat -ano | grep :3000` before trusting any device walk.

### Superseded next steps (as of 2026-09-02)

Phase G's device walk is now fully closed out: badge/spacing/error-message bugs fixed and
merged, and the save failure itself root-caused to a stale local API dev process (see above)
— confirmed fixed by saving a real workout ("Mine", `workout_templates.id
c50cee18-4218-4391-a43f-f58ae87099ef`) end-to-end from the physical device. **There is
currently no UI to see it** — Train's "My workouts" section is still the Phase 2 placeholder
text ("programs, previous workouts, and my workouts — coming soon"); wiring it to real data is
explicitly Phase J's job, deliberately not pulled forward.

1. ~~**Write the deferred RTL tests** for `builder.tsx` and `workout/[id].tsx`.~~ **Done.**
   `apps/mobile/src/app/__tests__/builder.test.tsx` (23 tests) and
   `workout-detail.test.tsx` (18 tests) cover the save flow's request body, the ordered
   validation message, the picked-exercise handoff and the Customise prefill. Three things
   worth carrying forward from writing them:
   - **`@testing-library/react-native` is v14, where `render()` and every `fireEvent.*`
     return Promises and MUST be awaited.** An un-awaited one leaves an open `act()` scope
     that silently empties the rendered tree for every *later* test in the same file — it
     presents as "unable to find an element" on tests that pass in isolation, which is a
     genuinely confusing symptom. **39 of the 64 mobile suites still call `fireEvent`
     without awaiting it**, which is the likely root of the suite's documented timeout
     flakiness (a full run under load failed 20 suites; the same run with less contention
     failed 4, and all 4 passed in isolation — every failure a timeout, never an assertion).
     Migrating those 39 suites is a worthwhile standalone task.
   - **One real bug fixed in `builder.tsx`**: the set/target steppers announced the domain
     display name (`Increase weight x reps`) while visibly reading `Reps` — a WCAG
     "label in name" mismatch. They now use `LABEL_BY_MEASURE`, the same map that renders
     the visible label. The name `TextInput` also gained the `accessibilityLabel` it lacked.
   - **Not covered, deliberately**: the Save button's `disabled={saving}` double-submit
     guard, and the second stepper's `Math.max(1, …)` floor for the time/distance measures.
2. ~~**Continue Phase 3** at **Phase H — live execution**.~~ **Phase H is code-complete**
   (H1–H5 all merged: PRs #79, #80, #81 and the notifications PR). The live workout, rest and
   timed-set screens exist, both entry points are wired, and the rest timer notifies via
   `expo-notifications` ([ADR-026](../decisions/ADR-026-rest-timer-notifications.md)).

   **Two things are outstanding and both matter:**
   - **The device walk has not happened**, and for H4 it is *mandatory* rather than optional —
     Jest cannot prove the OS schedules or delivers a notification. Walk: start a session, tick
     a set, lock the phone, confirm the buzz at the end of rest; then repeat and confirm that
     skipping rest early produces no notification.
   - **Five known production gaps are recorded** at the end of
     [`phase-3h-plan.md`](phase-3h-plan.md). The most serious: **crash recovery is not wired
     up.** `replaySessionState` exists and is tested but nothing calls it, so force-killing the
     app mid-session loses the session and orphans its events. The plan's own device-walk step
     ("kill the app mid-session, reopen and confirm it resumes") *will fail today*. Close that
     before Phase I, or alongside it.

   The plan is [`phase-3h-plan.md`](phase-3h-plan.md) — read that, not `phase-3-plan.md`'s
   Phase H paragraph, which was wrong in two ways it corrects:
   - **There is no `s_live()`.** `live` is one of nine *template-rendered* screens (see the
     prototype's `renderVals()` `TMPL` array), authored as declarative `{{ }}` markup from
     ~line 504 with its view-model at ~line 3423. Only `s_rest()` and `s_setTimer()` are
     real functions. `screenshots/live workout.png` and `live workout 2.png` both exist and
     outrank the prototype either way.
   - **The screen is roughly three times the size that paragraph implies** — a collapsible
     goal guide, a goal picker with apply-to-all, per-exercise unit and measure toggles, and
     a set table with previous-performance and PR columns.

   The plan splits it into five slices (H1 pure session reducer → H2 live screen → H3 rest
   and timed set → H4 notifications + ADR → H5 wiring the two dead CTAs), and records what is
   deliberately out of scope (the summary screen is Phase I; the live *run* screen is a
   separate modality; real heart rate needs a `HealthProvider`, so the Watch card ships as an
   honest empty state rather than the prototype's simulated bpm).

   **Open question 1 is settled: the rest timer WILL use `expo-notifications`** so a locked
   phone buzzes when rest ends — decided by the user this session, over the cheaper
   wall-clock-only option. That adds a native dependency, an OS permission prompt to place,
   and a **mandatory physical-device check before merge** (Jest cannot exercise notification
   scheduling). It gets its own ADR in slice H4.
3. **Device-walk Home and the nutrition work.** Saved meals, the share card (including the
   background-photo picker), avatar upload's compression, and now Home have not had a full
   physical-device walk since landing.
4. **Resolve `pr59-fixup2`.** A leftover, unregistered, clean git clone at
   `.claude/worktrees/pr59-fixup2` — never decided whether to keep or delete.
5. **One smaller follow-up spun off during Phase G's device walk, not yet started:** fixing
   the workouts e2e suite's missing test-fixture teardown (it leaks real rows into the shared
   dev DB — one already synced into a real device's exercise catalogue and briefly confused
   that session's debugging). The other follow-up from that walk — expired-session UX — is
   done (see above).
6. **Keep the local API dev server running under `npm run start:dev` (watch mode), not a
   one-off `node dist/main`.** A stale `node dist/main` process — started before the Workouts
   feature existed and never restarted — silently 404'd every `/workouts/templates` request
   for the rest of the day, which looked like an app bug for a long time before being
   root-caused. Watch mode picks up future backend changes automatically and avoids repeating
   this.

### Old status (superseded, kept for history below this point)

**Phase 1 is complete; Phase 2 has not started.** Phase 0 is complete except Spike B, which
is still open and does not gate anything in Phase 1 (see "Spike status" below).

### ⚠ Design revision — 2026-08-30 (read this before building any screen)

**The design was regenerated and 11 screens were added.** `FORJD mobile app design/FORJD
Mobile.dc.html` grew 234 KB → 365 KB. Verified delta, tokens, and what did *not* change:
[`docs/design/design-revision-2026-08-30.md`](../design/design-revision-2026-08-30.md).

- **New feature area — nutrition (6 screens)**, plus a "Nutrition Today" card on Home.
  Now **in MVP scope**, built as **Phase 2.5, immediately after Phase 2**
  — [ADR-020](../decisions/ADR-020-nutrition-in-mvp.md), plan in
  [`nutrition-plan.md`](nutrition-plan.md), screens in
  [`../design/nutrition-screen-specs.md`](../design/nutrition-screen-specs.md).
- **Five other new screens** — `pickUsername`, `favorites`, `newExercise`, `setTimer`,
  `athlete` — plus a Support group and Delete-account flow on `profile`. Specs in
  [`../design/design-revision-screen-specs.md`](../design/design-revision-screen-specs.md).
- **Two shipped decisions are overturned.** The handle/`@username` and the avatar upload are
  both back, by [ADR-019](../decisions/ADR-019-username-and-avatar.md). Where this file below
  records *removing* the `@jmitch` handle as a fidelity fix, that fix is now itself reverted.
- **Subscription screens ship as UI with no billing**
  — [ADR-021](../decisions/ADR-021-subscription-ui-without-billing.md).
- **Unchanged, checked rather than assumed:** design tokens are byte-identical, fonts and the
  `fj-atm-ember` atmosphere are unchanged, and the five-tab bar keeps its labels and order.
  Only the tab bar's *chrome* changed (safe-area padding, 44 px minimum targets, opaque
  background, icon 22→20, label 10→9.5).
- **The `design_handoff_forjd_mobile/*.md` bundle did NOT change** — `git diff
  --ignore-all-space` over it is empty. It is a frozen pre-revision snapshot that now omits an
  entire feature area. Do not build from it.

**Phase 2's screen work is complete as of Phase K** (Phases D through K all landed after the
revision). The revision added to Phase 2's scope (`favorites`, `newExercise`) rather than
redirecting it, and both landed: the `Favourites` filter chip in Phase I, `newExercise` in
Phase K.

**Phase E is done and merged.** The exercise library is readable over the wire now:
`exercises:load` (idempotent, wired into `deploy-api.yml` after `db:migrate`),
`GET /api/v1/exercises` with `q`/`category`/`muscle`/`equipment`/`favourite` and cursor
pagination, `GET /api/v1/exercises/:id`, and the `{ items, nextCursor }` envelope in
`@forjd/contracts` that **every list endpoint after this one should reuse** — look at
`listResponseSchema` there before inventing a second pagination shape.

**Phase F is done and merged** ([PR #46](https://github.com/Menshawy97/FORJD/pull/46), confirmed green on `main`). `imageUrl`/
`imageUrls` now resolve to real URLs once `EXERCISE_MEDIA_BASE_URL` is set —
`exercises:mirror-media` mirrors the catalogue's images into a public `exercise-media`
Supabase Storage bucket, wired into `deploy-api.yml` after `exercises:load`. One finding from
running it for real against the dev project, not just unit tests: a meaningful minority of
image paths get a bare `400` from `raw.githubusercontent.com` specifically — consistently on
retry, even after a 20s wait, while the same bytes fetch fine through GitHub's git-blob API —
which is upstream CDN flakiness, not a bug here. The mirror was redesigned around that finding
to catch and count per-key failures rather than abort the run, and the deploy step runs with
`continue-on-error: true` so a handful of broken image URLs never blocks a code deploy. Full
detail, including the real run's mirrored/failed counts, is in `phase-2-plan.md`'s Phase F
outcome section and ADR-018's "Finalized" note.

**Phase G is done and merged** (same PR). `POST /exercises`,
`PATCH /exercises/:id`, `DELETE /exercises/:id`, `PUT`/`DELETE /exercises/:id/favourite` —
the repository side already existed from Phase C, so this phase was the contract, the
`ExercisesService` policy (100% coverage pin, matching `athletes.service.ts`), and the
controller wiring on top. One design point worth knowing for Phase I/K: **`goal` is derived
server-side from `measure`**, never accepted from the client — the create/edit screen's own
"derived, not chosen" comment (`docs/design/phase2-screen-specs.md` §6.1), so
`createExerciseRequestSchema` has no `goal` field at all and a mobile client should not try
to send one. Full detail in `phase-2-plan.md`'s Phase G outcome section.

**Phase H is done and merged** (same PR).
`GET /exercises/catalogue` returns the whole visible catalogue plus a `catalogueVersion`, and
`apps/mobile/src/store/exercise-catalogue.ts` mirrors it into on-device SQLite with an FTS5
index, behind a function seam matching `notification-preferences.ts`'s AsyncStorage wrapper.
The version is a content hash that deliberately ignores favourite status — favouriting writes
straight into the local mirror instead of waiting for a re-sync. Full design reasoning is in
**ADR-022** (not ADR-019, which the original plan text cited before that number was claimed
by username/avatar). Full detail, including the sync/schema design, is in `phase-2-plan.md`'s
Phase H outcome section.

**Phase I is done and merged** ([PR #47](https://github.com/Menshawy97/FORJD/pull/47), confirmed
green on `main`; implemented, tested, and device-verified on a physical iPhone via Expo Go).
`/library` and the two `train.tsx` quick-action cards, per `phase-2-plan.md`'s Phase I outcome
section. Two real bugs surfaced only by the device walk, neither visible in Jest or the web
preview: (1) the catalogue sync's schema-creation ordering — fixed by creating the schema
before the first local read, not only inside the sync path — and (2) `gap`/background/border
set only inside a `Pressable`'s function-`style` callback is silently dropped on-device, the
same bug class `slice2-screen-specs.md`'s `SocialAuthRow` incident already documented,
recurring here across three call sites before being caught. A third finding,
`NativeDatabase.execAsync` throwing on the Android **emulator** specifically (not the physical
iPhone), is still open — see the Open Items list in `phase-2-plan.md`; it needs a physical
Android device check, not yet done, to confirm it is emulator-only.

**Phase J is done.** `/exercise/[id]` replaces the placeholder, branching internally on
`category === 'running'` per `phase2-screen-specs.md` §4-5 — header, tag pills (muscles +
goal, `'Running'` appended for the run variant), the equipment block, a **"How to train it"
tip** (a real prototype element missed during spec extraction, ported to
`exercises/training-tip.ts`), and (a deliberate addition beyond the prototype, §8) the
instructions list, sourced from the ingested dataset. Stat tiles, sparkline, history and the
running variant's route map/pace stats ship now too, but with **honest empty states** rather
than the prototype's hardcoded demo numbers — the user compared the shipped screen against a
reference screenshot and asked for exact layout parity; showing invented numbers as a real
user's own training data was rejected in favour of showing the layout with a clear "no data
yet" state that Phase 3 fills in later. The delete-confirmation sheet ships with its copy
reworded for the soft-delete (§8: "removed from the library", not "permanently removed...
can't be undone"), and calls the already-shipped `DELETE /exercises/:id` plus a new
`removeCachedExercise` in the on-device store so a deleted custom exercise disappears from the
library immediately rather than waiting for the next catalogue sync. `library.tsx` gained a
`toast` search-param so the delete flow's "Exercise deleted" toast can show after navigating
back, since the screen that triggers it unmounts first. Full detail in `phase-2-plan.md`'s
Phase J outcome section. Verified: 338/338 mobile Jest tests green at the time, typecheck and
lint clean, architecture conformance clean, and a real `expo export` bundle compile (no
errors). **Physical-device walk: the honest-empty-state stat tiles/sparkline/history and the
create-mode flow were confirmed live on a physical iPhone during Phase K's own session** — see
that paragraph below. The running variant, favouriting, and the delete flow remain
unconfirmed on-device.

**Phase K is done.** `/new-exercise` replaces its placeholder — name, the prototype's own
13-muscle/12-equipment chip subset (not the full canonical enum; recorded explicitly per
`design-revision-screen-specs.md` §3's own instruction, confirmed against three reference
screenshots), description, category, `Measured by`, and the same tap-time ordered-toast
validation the prototype uses (name → muscle → equipment → server-side duplicate-name 409).
One screen serves create and edit, prefilling from the on-device cache in edit mode. No
delete control here — the plan's own heading briefly said otherwise, but the prototype source
has none, and delete already lives on the exercise detail screen (confirmed again by a
`deletecustomexercise.png` reference). Two real fixes came out of a live device walk with the
user during this same session, not from a test: (1) the exercise detail screen's tip was
calling the generated `trainingTip()` fallback even for custom exercises — fixed so a custom
exercise's tip is its own `Description` field instead, since that field already asks for
"cues, setup or form notes"; (2) visible spacing drift from the reference screenshots, fixed
by moving every layout margin in `new-exercise.tsx` from a NativeWind arbitrary-className
value to an explicit numeric `style`, re-derived from the prototype's literal CSS rather than
approximated — the user confirmed the corrected layout live afterward. Verified: 362/362
mobile Jest tests green, typecheck/lint clean, real bundle compile succeeded.

**Same-session follow-up** (merged in the same PR, [#50](https://github.com/Menshawy97/FORJD/pull/50)):
the exercise detail screen now shows **both category and goal** as tag pills, not goal alone —
the prototype's own logic and the reference screenshots both confirmed goal-only was the
shipped design, but the user asked for both since they're distinct classifications; plus a
**`Custom` tag** on a user-authored exercise's own detail screen, and a **`Custom` filter
chip** on the library (after `Favourites`, same cross-category kind), backed by a new
`customOnly` option on `listCachedExercises`. Verified: 367/367 mobile Jest tests green.
Full detail in `phase-2-plan.md`'s Phase K outcome section. **Phase 2's screen work is
complete.**

**One Phase D finding the design revision needs to hear about:** the ingested catalogue leaves
the `yoga` and `calisthenics` categories **completely empty** — free-exercise-db has no source
category that maps to either — yet the library screen draws a filter chip for both. Phase I has
to decide what those chips do. See `phase-2-plan.md`'s Phase D outcome section.

### Mobile framework pivot: Flutter → Expo React Native

**`apps/mobile` is Expo (React Native) + TypeScript, not Flutter.** The Flutter
app described throughout the rest of this Phase 1 section (design tokens, Drift,
go_router, the 69-test suite) was deleted and replaced in the same change — see
**ADR-013** (`docs/decisions/ADR-013-expo-react-native.md`, supersedes ADR-001)
for the full reasoning: Expo Go's zero-build, hot-reload preview on a physical
iPhone from a Windows dev machine beats Flutter's Codemagic → TestFlight loop for
the screen-heavy phase of work the design handoff opened up. **ADR-014**
(`docs/decisions/ADR-014-openai-inbody-vision.md`, supersedes ADR-006 on vendor
choice only) rides along with it: InBody photo extraction moves to OpenAI vision
instead of Claude vision, since the pivot prompted standardizing on one AI vendor
for the app. Spike B's pipeline shape and confirmation-gate requirement are
unchanged; it still hasn't been run under either vendor. ADR-007, ADR-010, and
ADR-011 were amended (not replaced) to carry their reasoning over to the new
stack — see each ADR for what changed mechanically (Dio → axios,
`flutter_secure_storage` → `expo-secure-store`, Codemagic → EAS Build, etc.).

**Slice 1 of the Expo rebuild — auth + 5-tab shell, wired to the real backend,
test-first — is done.** This is the direct replacement for what the "Slice 11 —
Mobile auth UI" entry below describes; that Flutter work is superseded, not
current. The new slice was built RED→GREEN per phase (navigation shell, then auth
flow) against the actual NestJS `/api/v1/auth/*` endpoints, with `expo-secure-store`
token persistence and the same three-client (public / refresh / api) pattern with
refresh-dedup that ADR-011 established for Flutter. **117 tests passing across 37
suites** in `apps/mobile` (Jest + `@testing-library/react-native`), `typecheck` and
`lint` clean, and both the iOS and Android bundles compile (~9.6 MB each, zero
unresolved modules). CI's `mobile` job now runs `typecheck`, `lint`, and
`test --ci` for real (see `.github/workflows/ci.yml`) rather than the Phase-2
install-only stub.

**The Expo SDK is pinned to 54, not the latest.** Expo Go on the App Store ships a
single SDK version, and scanning an SDK-57 bundle with Expo Go 54 fails outright
with a version error. Since ADR-013's entire justification is the zero-build
Expo Go loop on a physical iPhone, the app follows whatever SDK Expo Go ships.
Downgrading surfaced one real API break worth remembering: `expo-router@6` (the
SDK 54 line) does not re-export `ThemeProvider`/`DarkTheme`/`DefaultTheme` — those
come from `@react-navigation/native` directly — while `Redirect` does still come
from `expo-router`. `jest.config.js` also sets `testTimeout: 30000`, because
`renderRouter()` rebuilds the whole route tree per call and overruns Jest's 5 s
default once workers contend for CPU.

**Design fidelity and a code review were both run against slice 1, and their
findings fixed.** The design was implemented against the runnable prototype
(`FORJD mobile app design/FORJD Mobile.dc.html`), *not* the handoff markdown —
the markdown paraphrases and was caught contradicting it outright (it gives the
login headline as "Log in"; the prototype and screenshots both say "Welcome
back"). A full audit then found 17 further gaps, all now closed. The ones worth
carrying forward as lessons:

- The app-wide **"ember" atmosphere** — `radial-gradient(130% 90% at 50% -10%,
  rgba(233,113,47,.20), #101011 55%)`, an orange glow from above the top edge — is
  the design's default on *every* screen, set in code (`atmosphere ?? 'ember'`)
  rather than in any screen's own styles. Transcribing the flat background token
  alone silently dropped it. It is now a shared `ScreenBackground` component
  (SVG `RadialGradient`, since `expo-linear-gradient` cannot do radial).
- There are **two darks**, and picking the wrong one is invisible in code review:
  `#08090A` is *"the desk, not the screen"* (outside the phone frame) and
  `#101011` is the screen itself. Three screens used the desk colour.
- **Safe-area insets** were absent app-wide; the prototype's 52 px status-bar row
  had been approximated with a hardcoded `pt-16`.
- The icon set was previously assumed not to exist and shipped as placeholder
  dots. **The full 22-glyph SVG path data is inline in the prototype** and is now
  transcribed into `src/components/icon.tsx`, verified path-by-path.

**Contract change — `sex` narrowed to three values.** `sexSchema` was
`male | female | other | prefer_not_to_say`; it is now
`male | female | prefer_not_to_say`, matching the three chips the prototype
actually draws (Male / Female / Rather not say). `other` had no chip at all, so a
stored `other` would have rendered nothing selected and been unreachable from the
UI. Narrowing was cheap and needed no migration because `sex` is a nullable
`text` column, not a Postgres enum (`profiles.schema.ts`). The compiler then
caught a **duplicate `Sex` type in `@forjd/domain`** that still carried the old
value — the two are now aligned, and that duplication is worth remembering as a
place where drift hides. Fixtures regenerated (content unchanged; the sample uses
`"female"`), API builds clean, 52 API tests still pass.

**Known open item, needs a human:** `eslint-plugin-react-hooks` is installed and
imported in `apps/mobile/eslint.config.mjs`, but its rules are not registered —
the ECC `config-protection` hook blocks edits to ESLint configs, and disabling a
protection hook is not a change to make unattended. Nothing enforces
`rules-of-hooks` / `exhaustive-deps` until this lands. The rules were verified to
pass cleanly against a throwaway config, so registering them is green work, not a
cleanup. See the PR description for the exact diff needed.
Slices 2-8 of the Expo rebuild (profile/settings, exercise library, live workout
+ offline sync, programs, InBody + AI module, real home/progress, ranking/
subscriptions) are sequenced but not built — see §9 of the mobile-pivot plan
(`C:\Users\Mostafa Ashraf\.claude\plans\i-have-added-the-declarative-cake.md`) for
the slice/screen/dependency breakdown; it is not duplicated here.

**Everything below this point that discusses the Flutter app** (design tokens,
Drift, go_router, the 69/60-Flutter-test counts, the emulator walk, the "All 14
slices" table's mobile-shaped rows 9-14) **is historical record of Phase 1 work
that has since been superseded by the pivot above**, kept for the reasoning it
captured rather than as a description of what's in `apps/mobile` today.

### Phase 1 progress

Executing the 14-slice plan. **Slices 1-11 are done and merged; `main` is green.** The
app has been walked end to end on an Android emulator against the live API — see "The
emulator walk" below.

Between slice 11 and slice 12, a **four-slice hardening batch (A-D)** ran and is merged —
see "Slices A-D" below. It was not in the original 14-slice numbering; it came from a
critical re-read of the roadmap that found the highest-leverage work in the repo was
unblocked and undone, while slices 12-14 were blocked on decisions rather than only on
accounts.

**PHASE 1 IS COMPLETE (2026-08-24).** Slices 12, 13 and 14 are done and merged. EAS Build
profiles exist and EAS is linked; the API is **deployed and live on Cloud Run staging**
(`https://forjd-api-staging-772363715082.us-central1.run.app`, health check green, database
reachable via the session pooler); and the definition-of-done walk — register → login →
refresh → logout → view/edit profile, **against deployed staging from a physical device** —
passed end to end, including the 401 → refresh → replay path that no previous walk had ever
been able to exercise. The other half of the definition of done was already mechanically
true and enforced by CI: nothing outside `apps/api/src/auth/providers/` imports the Supabase
SDK.

> ### ✅ Expo Go device loop — fixed 2026-08-25
>
> The app previously failed to render in Expo Go, breaking the physical-device loop ADR-013
> built the whole Expo pivot around. **Confirmed working again on a physical iPhone.** Root
> cause and full writeup: [`docs/product/expo-go-duplicate-sdk-tree.md`](expo-go-duplicate-sdk-tree.md)
> — `expo@54` declares `@expo/dom-webview` as an optional peer with an unbounded `"*"` range,
> which pnpm resolved to an SDK 57 release, dragging a parallel SDK 57 tree (`expo-router@57`,
> `react-native@0.86.2`, ~40 more) alongside the SDK 54 tree the app targets. A single Metro
> `resolver.blockList` fix closed both symptoms this produced (a codegen crash, then a
> two-copies-of-expo-router render error) — the doc records the likely mechanism and what
> remains only partially understood, since one diagnostic approach was tried and **reverted**
> (it broke 39 mobile test suites) before it could fully confirm the causal chain. That
> doc says exactly what and why, so don't repeat it. Backend work (Phases D–G) is unaffected.

**Phase 2 (exercise database) has been re-planned, and the plan is in the repo:
[`docs/product/phase-2-plan.md`](phase-2-plan.md).** Read it before writing any Phase 2 code —
it carries the locked-decisions table, the phase-by-phase build order (Phase 0 through K) and
the verification steps. Its companion design spec is
[`docs/design/phase2-screen-specs.md`](../design/phase2-screen-specs.md), extracted from the
runnable prototype with a script rather than by eye.

Three decisions from that re-plan are worth knowing without opening it. **Custom exercises and
favourites are in Phase 2**, not deferred — so the library screen ships as the prototype draws
it, the "＋ New" pill included. **Exercise imagery is a recorded stopgap:** free-exercise-db's
photographic stills were rejected on quality (the bar named was Hevy, whose demos turn out to be
3D-rendered MP4s self-hosted on its own S3), no free source produces that look, and there is no
budget — so the stills ship mirrored into our own Supabase Storage bucket, with the database
holding a storage *key* rather than a URL so replacing them later is one script rather than a
migration. See [ADR-018](../decisions/ADR-018-exercise-media-hosting.md), which records both
exits: buy a commercial pack, or get a legal read on Everkinetic's CC BY-SA — the *same*
share-alike question ADR-005 already queued for wger, so it costs nothing extra to ask.
**The search is both server-side and on-device** (`expo-sqlite` + FTS5, full versioned
catalogue sync), which is also what Phase 3's offline workout execution will need.

Two things carry forward and are easy to lose: the five deployment failure modes recorded
under slice 13 (every one will recur when production is set up, and two prod secrets are
already known-wrong), and the requirement for **custom SMTP before beta** — Supabase's
built-in mailer caps a project at ~2-4 emails/hour, which with confirmation on is the signup
ceiling, and was hit within minutes during the walk.

Half of the phase's definition of done is already mechanically true: exactly one
file imports the Supabase SDK for auth, one for storage, and nothing else —
verified by grep in CI rather than by discipline.

**Current test surface:** 52 API unit tests, 12 API e2e tests, 69 Flutter tests, all
passing, with real coverage floors enforced in CI for the first time (see slice C). Lint,
format, `flutter analyze`, and the architecture-conformance check are green. CI now builds
a *release* APK with a size budget, not a debug one — see slice C for what that does and
does not catch.

### Slice 11 — what it turned out to be

Slice 11 grew beyond "mobile auth UI" because the imported
[FORJD Mobile design](https://claude.ai/design/p/6dd27911-0e14-43cb-bebd-8c673fa83641)
is dark and typography-led while the app was on a green-seed Material 3 theme, and
because two of its screens asked for API surface that did not exist. Three scoping
decisions were taken deliberately:

1. **Design tokens land before the screens**, plus the full five-tab navigation shell.
   Building slice 11's screens against the old theme would have meant building them twice.
2. **`registerRequestSchema` gains an optional `displayName`**, so the design's "Full name"
   field is honoured server-side rather than discarded.
3. **`POST /auth/forgot-password` is real**, backing the design's "Forgot password?" link.

Landed, each its own commit, everything green at each step:

| Step | Status | Detail |
|---|---|---|
| A1 — `displayName` at register | ✅ Done | Optional in the contract (rule 7), written to `profiles` rather than provider metadata so there is one system of record for the name. |
| A2 — `POST /auth/forgot-password` | ✅ Done | 202 with an empty body whether or not the address exists. `AuthProvider.requestPasswordReset` returns `void` so no implementation *can* leak the difference; the Supabase adapter swallows GoTrue's "user not found" into a log line; the audit row uses a null user id so latency does not reintroduce the enumeration channel. Throttled to 3 per 15 minutes. |
| B1 — Design token layer | ✅ Done | `AppColors` / `AppText` / `AppDimens` plus a rewritten dark-only `AppTheme`. `ColorScheme` written out, never seeded. **`AppTheme.light` deleted.** CSS `em` letter-spacing converted to logical pixels with the arithmetic in comments. |
| B2 — Archivo bundled | ✅ Done | SIL OFL 1.1, licence committed alongside. Bundled rather than `google_fonts`: no third-party network call to render a login screen. Only a variable face is published upstream, so weight moves through the `wght` axis — use `AppText.weighted`, never a bare `copyWith(fontWeight:)`. |
| B3 — Widget library | ✅ Done | Button, text field, labels, list row, chips, header, brand marks, tab bar. Icons keep the design's SVG path data and are stroked in a `CustomPainter` via `path_drawing`; a test parses all 24 rather than trusting transcription. |
| C2 — Network layer | ✅ Done | Three Dio clients (public / refresh / api), `ApiFailure` mapping, and the 401 → refresh → replay interceptor. Concurrent 401s share one in-flight future, so N of them cause exactly one refresh. |
| C1 — Auth models + controller | ✅ Done | Sealed `AuthState` (five variants), `SecureTokenStore`, `AuthRepository`, `SessionRefresher`, `AuthController`, `main.dart` port overrides. |
| C3 — Auth screens + router gate | ✅ Done | Welcome/login/register/forgot-password, redirect via `refreshListenable`, `_Placeholder` deleted and `widget_test.dart` rewritten in the same commit. |
| 8 — Shell + tab bar wiring | ✅ Done | `StatefulShellRoute.indexedStack`, five branches, four honest placeholder tabs. |
| 9 — Profile + edit profile | ✅ Done | `GET /users/me`, `PATCH /users/me/profile`, `appDatabaseProvider`, Drift-cached display name as the in-flight fallback. |
| 10 — ADR-010, ADR-011 | ✅ Done | `docs/decisions/ADR-010-mobile-design-system.md` and `ADR-011-mobile-session-lifecycle.md`. |

**One bug worth remembering, found by a test rather than in the field:** replaying a
request through the interceptor's own Dio deadlocks. `QueuedInterceptor` serialises its
callbacks, so the replay queues behind the `onError` that is awaiting it and the request
hangs until it times out. The replay client must not carry the interceptor.

### Slices A-D — hardening between slice 11 and slice 12

Four slices, each its own PR, each merged with `main` green afterward (PRs #7-#10). Not
part of the original 14-slice numbering — they came out of re-reading the roadmap
critically rather than executing the next listed slice by default.

| Slice | Status | Detail |
|---|---|---|
| A — testability seam + index + baseline | ✅ Done | `SupabaseAuthProvider` now takes an injected Supabase client (`SUPABASE_AUTH_CLIENT`), so the weak-password passthrough, the enumeration-defence collapse, and the password-reset swallow are unit-tested for the first time — 8 new tests, closing an ADR-011 gap that had stood since slice 11. `audit_logs.user_id` indexed (migration `0002`) — the unindexed FK was sequential-scanning the fastest-growing table on every `ON DELETE SET NULL`. `scripts/perf/measure-auth-latency.ts` added so slice B could be argued from a number. |
| B — local JWT verification | ✅ Done, **ADR-012** | `verifyAccessToken` verifies in process against the project's published ES256 keys instead of calling Supabase. Measured on `GET /users/me`: p50 **123.3 ms → 14.3 ms**, p95 **253.1 ms → 20.7 ms**. `IdentityCache` removes the remaining per-request DB read, bounded and keyed on external id **and** email so a re-pointed address still re-enters the repository's ownership check. 10 tests sign real tokens with a throwaway key, including both `alg: none` and the HS256-signed-with-the-public-key confusion attack. **The tradeoff is real and stated in the ADR**: an access token can no longer be recalled before it expires, so the token lifetime is now the revocation window — see the manual steps below, this is not finished until it is shortened. Walked on the emulator afterward; nothing broke, nothing new found (see below). |
| C — real CI gates | ✅ Done | The repo has claimed 80% coverage since Phase 1 and enforced nothing. Now enforced: API `coverageThreshold` (43% general pool, **100% floor on `auth/guards/**` and `auth.service.ts`**), a Flutter lcov floor (75%), a release-APK size budget (+5% of measured), and a conformance grep pinning `flutter_secure_storage` to `secure_token_store.dart`. Every gate was watched to fail against a planted violation before being committed. CI now builds a **release** APK, not debug — the debug build ran no AOT compilation and no tree-shaking, so it could not have caught a size regression. **Correction to the original plan**: a release build does not exercise R8 — Flutter does not enable minification by default, confirmed by inspecting the dex — so enabling it is deferred to its own slice pending a device walk. `cupertino_icons` dropped (546 bytes; genuinely unused). `uses-material-design` stays `true`: the icon set has no eye or pencil, and Material Icons tree-shakes to 2,212 bytes, so the honest cost of keeping it is 2 KB, not 1.6 MB. |
| D — contract-drift fixtures | ✅ Done | The Dart DTOs mirror the Zod contracts by hand and nothing checked they agreed — flagged as an open follow-up since slice 11. `packages/contracts/src/fixtures.ts` now defines one example per response shape, each validated by its own schema before being written to `packages/contracts/fixtures/*.json`; a Dart test parses those exact files through the real DTOs. CI regenerates the fixtures and fails on any diff. **Correction to the original plan**: it called for capturing real e2e response bodies as fixtures, which would have committed a live access token to the repo on every run; invented, schema-validated values are used instead — safer, and a tighter check, since the awaiting-confirmation and empty-profile cases were chosen deliberately rather than left to whatever a run happened to produce. Verified both directions: a renamed contract field produced `Expected: 172.5, Actual: null`; a deleted fixture failed the parser-coverage test. |

Two corrections to the plan surfaced only by doing the work, both recorded above rather
than silently absorbed: the release-build size gate does not imply R8 is running, and the
fixture strategy changed from "capture live" to "generate from schema" once the security
cost of the first approach became concrete.

### The emulator walk

The UI was walked on a Pixel 7 / Android 14 emulator against the local API and live
Supabase. It is worth doing again after any UI change — it found four things the 58 tests
passing at the time did not.

**The emulator already exists.** Do not re-derive this:

```bash
# AVD: forjd_pixel7_api34  (Play Store image, so Health Connect works on it in Phase 6)
/c/Android/Sdk/emulator/emulator.exe -avd forjd_pixel7_api34 -no-snapshot-load -gpu host
```

`-gpu host` matters. The default software renderer ANR'd the emulator's own SystemUI at
1080x2400 before the app could be used. Drive it with `adb shell input tap|text` and read
the result with `adb exec-out screencap -p`; the package is **`com.forjd.forjd`**. No app
config is needed — `apiBaseUrl` already defaults to `http://10.0.2.2:3000/api/v1`, which is
the emulator's alias for the host. A physical phone would need the machine's LAN IP instead.

**Confirmed working on device:** register with a name → session → app; the name surviving to
`/users/me`; all five tabs; profile initials fallback; edit → save → `PATCH` persisting
server-side; wrong credentials keeping the user on the form; the reset panel revealing
nothing about whether an account exists; logout clearing the device; and a cold restart
while signed in going straight to `/home` with no welcome-screen flash. It also exercised
the weak-password passthrough, which ADR-011 records as having no automated test.

**Found and fixed** (PR #3): a stale failure greeting the next form opened; a field error
persisting while being corrected; the contract accepting a space as a symbol when Supabase
does not; and the Flutter-default white launch screen flashing on every cold start of a
dark app. The space-as-symbol bug was introduced earlier in the same session that fixed the
password policy — only typing into a real form exposed it.

**Found and left alone**, because each is a judgement call rather than a defect:

- `AppColors.errorText` (`#E05A3C`) sits close to the accent, so "Invalid credentials" reads
  a little like the "Forgot password?" link above it. Changing it means changing the design's
  palette.
- There is no `calendar` icon among the 24, so the birthday field uses `clock`. Fixing it
  means adding a path to the icon set.
- `applicationId` is `com.forjd.forjd` — the doubled segment is Flutter's default org+project
  naming. Slice 12's flavors have to set this anyway; fix it there.
- The launcher icon is still the default Flutter icon.

**What an emulator still cannot cover**, and why the phone is not optional: no real health
data (Phase 6), a software-backed keystore rather than hardware, no WHOOP device (Phase 7),
a synthetic camera for InBody capture (Phase 5), and no sense of using the app mid-set in a
gym. Rule 16 and ADR-007 both assume real hardware for health work.

### Phase 2.4 — username and avatar (ADR-019) — ✅ DONE

Full vertical slice, per the user's explicit choice of "full ADR-019 slice" over the narrower
alternatives (username-only, or just `edit-profile.tsx`'s field). See
[ADR-019](../decisions/ADR-019-username-and-avatar.md) for the decision and its consequences
list.

**Backend:** `apps/api/drizzle/0010_new_champions.sql` adds `profiles.username` (nullable
`text`) plus a partial, case-insensitive unique index (`profiles_username_unique` on
`lower(username) WHERE username IS NOT NULL`), mirroring `exercises_owner_name_unique`'s
pattern. `profileResponseSchema`/`updateProfileRequestSchema`/`publicProfileResponseSchema`
gain `username`. The profile-patch endpoint reuses itself for the uniqueness check — no
separate endpoint — mapping a Postgres `23505` on that index to `ConflictException('That
username is taken.')`, the prototype's own copy. Avatar upload is a new `POST
/api/v1/users/me/avatar` (multipart, field `file`) through `StorageProvider`, never the
Supabase SDK directly (rule 11): a new `StorageProvider.getPublicUrl()` method plus
`UsersModule.onModuleInit` calling `ensureBucket('avatars', {public: true})`, so `avatarUrl`
stays a stable `http(s)` URL rather than an expiring signed one — same reasoning as the
exercise-media mirror's public bucket (ADR-018). Response is deliberately minimal,
`{avatarUrl: string}` (`AvatarUploadResponse`), not the full profile. The stale "no handle"
schema comment was checked and found already absent from `profiles.schema.ts` by the time
this landed.

**Mobile:** new `apps/mobile/src/app/pick-username.tsx` (ported from the prototype's
`s_pickUsername()`, verified against `create account username.png`), wired into
`signup.tsx`'s post-registration navigation (`/pick-username` before `/goals`). Shared
`apps/mobile/src/auth/username.ts` sanitizer (`toLowerCase` + strip non-`[a-z0-9_]`) used by
both `pick-username.tsx` and the new Username field in `edit-profile.tsx`, which also gained
the avatar circle + camera badge + "Change photo" control (`expo-image-picker`, added as a
dependency — `npx expo install --check` run to keep it aligned with the pinned SDK 54, per
`apps/mobile/AGENTS.md`). `(tabs)/profile.tsx` now renders `@username` alongside city (not
replacing it, per ADR-019's "alternatives rejected"); `athlete/[userId].tsx` gains the same
handle line and its stale "No handle line" divergence comment was rewritten. New `camera`
glyph added to `icon.tsx`. `apiClient.ts`'s `uploadAvatar()` was verified against the real
backend contract above (not just assumed) — route, multipart field name, and response shape
all confirmed to match exactly.

**Verified:** Backend — 24 new tests, 110/110 passing for the touched packages (`users`,
`athletes`, `storage`), `tsc --noEmit` and `eslint` clean. E2E suites are blocked sandbox-wide
on missing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (pre-existing, confirmed by unrelated
suites failing identically — not a regression from this change; needs a real Supabase-backed
run before merge). Mobile — full suite **70 suites / 396 tests, 0 failures**, `tsc --noEmit`
and `eslint` clean.

#### Retrofit — image compression pipeline (ADR-024) — ✅ DONE

`AvatarUploadService` shipped above with **no compression**: it accepted any file up to 5 MiB
of an allowed MIME type and stored the raw bytes unchanged. [ADR-024
](../decisions/ADR-024-image-compression-and-storage.md) closes that gap with a two-stage
pipeline — client-side pre-resize, then a mandatory server-side canonical re-encode that never
trusts what the client sent.

**Backend:** `AvatarUploadService.upload()` now unconditionally re-encodes every accepted
upload with `sharp` (new `apps/api` dependency) — `resize(512, 512, { fit: 'inside',
withoutEnlargement: true })` then `.webp({ quality: 80 })` — before it reaches
`storageProvider.upload()`. `ALLOWED_AVATAR_TYPES`'s old role (input MIME type → *stored*
extension) is retired; the replacement, `ALLOWED_AVATAR_MIME_TYPES`, is a pure input-validation
gate, decoupled from the always-`.webp` stored key/content-type. `MAX_AVATAR_BYTES` is
unchanged and still gates the input size before decoding. A `sharp` decode failure (corrupt or
non-image bytes that passed the MIME-type check) is caught and re-thrown as the same
`BadRequestException` pattern the rest of the method already uses, not an unhandled 500.

**Mobile:** new shared utility `apps/mobile/src/media/resize-image-for-upload.ts` —
`resizeImageForUpload(uri, { width, height }, maxDimension)` — using `expo-image-manipulator`
(new dependency, `~14.0.8`, installed via `npx expo install` to stay aligned with the pinned
SDK 54). Computes target dimensions itself (fit-inside, never upscale) from the picked asset's
own reported `width`/`height` — `ImagePickerAsset` already returns them, so no extra native
call (e.g. `Image.getSize`) was needed just to learn them; this is a deliberate, ADR-consistent
simplification, not a spec deviation. Wired into both `edit-profile.tsx` and
`pick-username.tsx`'s `handlePickAvatar`, between the picker result and `uploadAvatar()` — the
resized result's URI is what gets uploaded, not the raw picked one. Client-side output is WebP
at compression `0.8`, matching the server's own format so there is no format mismatch to
reason about; this step is a UX/bandwidth optimization only, per the ADR — the server re-encode
is the correctness guarantee and runs regardless of what arrives.

**A mock-hoisting bug found and fixed along the way, mobile side.** The first draft of the
three new/updated mobile test files built their `expo-image-manipulator` mock by declaring
`mock`-prefixed consts *before* `jest.mock(...)` and referencing them from the factory — the
common pattern, and one Jest's hoisting plugin permits syntactically. It does not, however,
guarantee those consts are initialized before the factory actually runs (Jest's own docs say
so explicitly), and here they weren't: `ImageManipulator.manipulate` came back `undefined` at
call time, first caught by `resize-image-for-upload.test.ts`'s own assertions rather than
silently passing. Fixed by building the mock entirely inside the factory and pulling the same
`jest.fn()` back out via the mocked import afterward — the guaranteed-safe form of the pattern.

**API's actual named export shape differed from the docs fetched while planning**, too: SDK
54's `expo-image-manipulator` exports a named `ImageManipulator` object (`import {
ImageManipulator, SaveFormat } from 'expo-image-manipulator'`), not a `manipulate` free
function — confirmed against the installed package's own `.d.ts` files after `tsc --noEmit`
caught the mismatch, not assumed a second time.

**Verified:** Backend — 4 new compression tests (real `sharp`-generated fixtures, not mocked:
oversized-image resize+re-encode, no-upscale on an already-small image, corrupt-buffer
rejection as `BadRequestException`, WebP output regardless of input format) plus the 7 existing
`AvatarUploadService` tests updated for the new WebP-always contract — 11/11 passing in
isolation, and passing again as part of the full 488-test suite once run with real
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` placeholders and a locally-migrated Postgres
(mirroring what CI's Postgres service container provides). `tsc --noEmit`, `eslint`, and
`scripts/ci/check-architecture-conformance.sh` all clean. A handful of unrelated DB-backed
suites (`exercises.repository`, `nutrition.repository`) and the e2e suite timed out under this
sandbox's own resource contention when run back-to-back with other suites — the same
pre-existing, sandbox-only gap ADR-019's own verification note already recorded, reconfirmed
here rather than re-litigated, and not reproducible against files this change touches when run
in isolation. Mobile — 4 new tests for the shared utility plus the two screens' existing avatar
tests updated to mock `expo-image-manipulator` and assert on the resized URI, 31/31 passing in
isolation; `tsc --noEmit` and `eslint` clean; a real `expo export --platform android` bundle
compile (1,545 modules) succeeded with no bundle-breaking errors. The full mobile suite hit the
same kind of sandbox-only `renderRouter` timeout flakiness this repo's own test comments already
describe ("a flake, not a bug") on screens this change never touches (login, profile Go Pro
banner, CTA affordances, etc.) — none of it in the files this change added or edited. CI's
dedicated runner is the authoritative signal for both suites, per this project's standing rule.

### Deviations from the design, decided rather than drifted

The design shows things the API cannot yet support. Each was a deliberate call, not an
oversight, and each is a follow-up rather than a silent omission:

- **`@username`** — ~~omitted~~ **REVERSED 2026-08-30 by
  [ADR-019](../decisions/ADR-019-username-and-avatar.md).** The design revision makes the
  handle load-bearing (a dedicated onboarding screen, an Edit Profile field, and the public
  profile), so it becomes a real column with case-insensitive uniqueness. Still absent from
  the backend at the time of writing — scheduled as Phase 2.4.
- **Profile stat tiles** (147 Workouts / 9 This Month / #47 City Rank) — no data source until
  Phases 3 and 6. Omitted entirely rather than rendered as zeros, which would read as a bug.
  **Still correct after the 2026-08-30 revision**, which added the same tiles to the public
  `athlete` screen: the data still does not exist, so they stay omitted rather than faked.
- **Avatar upload** — ~~deferred to Phase 5~~ **REVERSED 2026-08-30 by
  [ADR-019](../decisions/ADR-019-username-and-avatar.md).** The revision puts an upload
  control in two places (`pickUsername` and `editProfile`), so `StorageProvider` gets its
  first consumer ahead of InBody. Scheduled as Phase 2.4.
- **`heightCm` and `unitSystem`** — editable in the API, absent from the design's edit screen.
  Left out for now, which means `unitSystem` stays `metric` until the first Phase 3 screen
  that shows a weight forces the conversation.
- **Sex chips** — the design draws three, `sexSchema` has four values. Rendering four, so
  `other` is not a value the API accepts but the UI can never produce.
- **Password reset is only half a flow** — `resetPasswordForEmail` sends a link; *completing*
  the reset needs a deep link plus `POST /auth/reset-password`. The mobile screen ends at
  "Check your email" and the user finishes in a browser. **This is the largest known gap.**
- **Email-confirmation state** — the design has no such screen, but `registerResponse.session`
  is nullable and `forjd-dev` returns null. The "check your inbox" panel is an addition to
  the design, not an implementation of it.
- **Input focus ring** — the design specifies none. A 1px accent border was added, because an
  invisible focus state is an accessibility regression.

### Password policy: mirrored in the contract, and partly surfaceable

Walking the flow against live Supabase found a dead end. The project enforces a password
complexity policy (lower + upper + digit + symbol); `registerRequestSchema` required only
`min(8)` and the signup hint said "Min. 8 characters". A password that satisfied our contract
and matched our own hint came back as a bare 401 "Registration failed".

Two rules came out of fixing it:

1. **`registerRequestSchema` mirrors the provider's policy**, and **the symbol class must match
   Supabase's exact set** — not a broad `[^A-Za-z0-9]`. A space satisfies the broad class and
   not Supabase's, so `"Str0ng Pass1"` passed our validation and was rejected by the provider.
   That was caught by typing it into the real form, not by any test. A rejection is then a
   400 naming the field. If the policy changes in the Supabase dashboard, change it here
   too — the duplication is deliberate, and drift between them is what caused both bugs.
2. **Login keeps `min(1)`, permanently.** Applying a current policy to an existing password
   locks out everyone whose password predates it. An e2e test pins this: a policy-shaped
   password at login must fail on credentials (401), never on validation (400).

And one correction to the enumeration defence: `SupabaseAuthProvider.reject()` collapsed
*every* `signUp` error into one message. That is right for "user already registered", which is
an enumeration vector, but wrong for a weak password — that reveals nothing about whether an
address has an account, so hiding it protected nobody. Password-policy failures now pass
through as a 400; everything else stays generic.

**Not covered by a test:** the adapter's weak-password passthrough itself. `SupabaseAuthProvider`
builds its client in the constructor via `createClient`, so there is no seam to inject a stub
through. It was verified by hand against the live project; making it testable means a
constructor-injectable client, which is a small refactor nobody has needed yet.

### Follow-ups opened by slice 11

- Password-reset **completion**: deep link + `POST /auth/reset-password`.
- Per-email rate limiting on forgot-password. `ThrottlerGuard` keys on IP, so today it caps
  an origin, not an address; Supabase's own per-address limit is the only real backstop.
- Username/handle, avatar upload (Phase 5), profile stat tiles (Phases 3/6).
- ✅ **A real coverage gate — done.** `coverageThreshold` in `apps/api/package.json` and
  `scripts/ci/check-flutter-coverage.sh`, both wired into CI and both shown to fail against
  a planted violation. The floors are set at what the suites measure today (API 43% on the
  general pool with a separate **100% floor on `auth/guards/**` and `auth.service.ts`;
  Flutter 75%) rather than at the stated 80%, because a threshold chosen for how it sounds
  fails on the day it lands and is deleted the day after. Raise them deliberately.
  The API figure reads lower than the API really is: controllers and services are covered by
  the e2e suite, which runs as a separate jest project and contributes no coverage data.
  **Merging the two runs' coverage is the next real improvement here.**
- ✅ **Contract-drift check — done (slice D).** Generated fixtures, schema-validated, parsed
  through the real Dart DTOs in CI. Full codegen (Zod → Dart) remains a further step, not
  attempted here — worth revisiting once the contract passes roughly 20 types.
- ✅ **Conformance grep pinning `flutter_secure_storage` to `secure_token_store.dart` — done**,
  and verified both ways: it catches a planted import elsewhere and allows the legitimate one.
- Golden tests. Deliberately skipped: `flutter test` substitutes Ahem for bundled fonts, so
  goldens need an explicit `FontLoader` — a separate decision (ADR-010).
- Three icons the set does not have: `calendar` (the birthday field uses `clock`), plus
  `eye` and `pencil`. The last two are why `uses-material-design` is still `true` — the
  password-visibility toggle and the edit affordance are Material glyphs. Worth knowing before
  anyone treats that as waste: Flutter subsets the icon font to the codepoints actually used,
  and the release build tree-shakes MaterialIcons from 1,645,184 bytes to **2,212**. Drawing
  the three icons is a design task, not a size optimisation.

- **R8 is not enabled**, so the release APK is unminified. Flutter does not turn on
  minification by default, and the CI size gate measures the build as it actually is
  (20,861,242 bytes, single-ABI arm64). Enabling `isMinifyEnabled` would shrink it and make
  it harder to reverse-engineer, but Drift, `sqlite3_flutter_libs` and
  `flutter_secure_storage` all need keep rules that can only be trusted after a device walk —
  so it is a deliberate slice of its own, not a flag to flip. Re-baseline the size budget when
  it lands.
- The launcher icon is still the default Flutter icon.
- `AppColors.errorText` (`#E05A3C`) sits close to the accent, so an inline error reads a
  little like a link. A palette decision, deliberately not taken unilaterally.
- ✅ **Weak-password-passthrough test — done (slice A).** The Supabase client is now
  injected (`SUPABASE_AUTH_CLIENT`), giving a stub seam; 8 tests cover the passthrough, the
  enumeration collapse, and the reset swallow.

### All 14 slices

| Slice | Status | Detail |
|---|---|---|
| 1 — NestJS scaffold | ✅ Done | `apps/api` on NestJS 11, global `/api/v1` prefix, pino logging, Sentry inert without `SENTRY_DSN`. `GET /api/v1/health` verified 200; unprefixed `/health` returns 404. |
| 2 — Drizzle + Postgres | ✅ Done | `drizzle.config.ts`, `DatabaseModule` exposing `DRIZZLE`/`PG_POOL` tokens, pool closed on shutdown. Health endpoint reports `{status:'ok',database:'up'}` against the docker-compose Postgres. `db:generate`/`db:migrate`/`db:studio` wired. |
| 3 — Provider interfaces + ADR-008 | ✅ Done | `AuthProvider` and `StorageProvider` interfaces written; **ADR-008 created and now Accepted** — it did not exist before, ADR-003 only carried a placeholder. `domain-model.md`, `integrations.md`, ADR-003 updated to point at it. |
| 4 — Auth & profile slice | ✅ Done | `users`/`profiles`/`audit_logs` migrations; `@forjd/domain` + `@forjd/contracts` packages (Zod-backed wire contracts); `SupabaseAuthProvider`; `AuthService`/`AuthController` (`register`/`login`/`refresh`/`logout`); `JwtAuthGuard`; `UsersRepository`/`Service`/`Controller` (`GET /users/me`, `PATCH /users/me/profile`). **Verified live against Supabase** — registration created the user, mapped `supabase_user_id`, auto-created the profile, and wrote the audit row. |
| 5 — StorageProvider impl | ✅ Done | `SupabaseStorageProvider` + `StorageModule`, bound but deliberately unconsumed until Phase 5. The `inbody` bucket exists and responds. |
| 6 — Remaining migrations | ✅ Done | `goals`, `preferences`, `feature_flags` as migration `0001`. Schema only — no endpoints, since Phase 1's scope is profile view/edit. |
| 7 — CI lint/test | ✅ Done | `.github/workflows/ci.yml` with `api` (Postgres service container) and `mobile` jobs. Not yet exercised on GitHub — no push made. |
| 8 — CI conformance grep | ✅ Done | `scripts/ci/check-architecture-conformance.sh`. **Verified non-vacuous**: catches a planted Supabase import outside the provider dirs, allows the same import inside them. |
| 9 — Flutter shell | ✅ Done | `flutter create` scaffold + go_router routes, Riverpod, Dio client, theme. Analyzer clean, tests pass. |
| 10 — Drift scaffold | ✅ Done | `AppDatabase` with a `CachedProfiles` table. Timestamps stored as **ISO-8601 text**, not Unix seconds — the default returns local time and silently shifts any instant that crossed a timezone. See `apps/mobile/build.yaml`. |
| 11 — Mobile auth UI | ⬜ **Superseded** | Was merged as Flutter (PRs #2, #3): design tokens + Archivo, widget library, 401→refresh→replay network layer, auth screens, 5-tab shell, profile/edit-profile, ADR-010/011. Walked on an emulator; four findings fixed; 60 Flutter tests; debug APK builds. **The Flutter app this built no longer exists** — see "Mobile framework pivot" above. Its replacement is the Expo rebuild's **Slice 1** (auth + 5-tab shell, wired to the real backend, test-first, 35 tests), done under ADR-013. |
| 12 — Build flavors | ✅ Done | Re-scoped for Expo: `apps/mobile/eas.json` with `development`/`staging`/`production` EAS Build profiles setting `API_BASE_URL`, consumed via `app.config.ts`'s `extra.apiBaseUrl`. EAS project linked under the `forjd` org. |
| 13 — Staging deploy | ✅ Done | Live at `https://forjd-api-staging-772363715082.us-central1.run.app` (health green, DB reachable). `apps/api/Dockerfile` (3-stage, prod deps only) + `.github/workflows/deploy-api.yml`, auto-deploying on green CI on `main`. Five recurring failure modes recorded under "Next, in order" — read them before setting up production. |
| 14 — Device DoD walk | ✅ Done | Walked on a physical iPhone via Expo Go against **deployed staging**, 2026-08-24. Every DoD step passed, including the 401 → refresh → replay path exercised for real by waiting out the 900 s token — untested in every prior walk. Two findings fixed and merged (PR #33). **Phase 1 closed.** |

Phase 1's definition of done is unchanged: register → login → refresh → logout →
view/edit profile against the deployed staging API from the physical device, with
no file outside `apps/api/src/auth/providers/` importing the Supabase SDK.

### Deferred deliberately from the Phase 1 review

Two review findings were judged as tradeoffs rather than defects, and are tracked here
rather than silently dropped.

**Token verification is uncached.** ✅ **Resolved — see ADR-012.** Tokens are now verified
in process against the project's published ES256 signing keys. Measured on the cheapest
authenticated endpoint, p50 went from 123.3 ms to 14.3 ms and p95 from 253.1 ms to 20.7 ms.
The decision was taken the way this entry asked for it: with a measurement first, and with
the cost written down. That cost is that an access token cannot be recalled before it
expires, so **the access-token lifetime is now the revocation window** — currently 3600 s
and needing to be set to 900 s in the Supabase dashboard. That manual step is listed below
and ADR-012 is incomplete until it is done.

**RLS is enabled on no table.** Acceptable today because nothing except the API holds a
Postgres credential — the mobile app has no Supabase client, and the CI conformance check
structurally prevents one appearing. It stops being acceptable the moment either the
storage adapter hands clients signed URLs (Phase 5) or any client gets a direct Supabase
key. **Gating rule: enable RLS before any client receives a Supabase credential.**

One more, unfixable here: `drizzle-kit` pulls a transitive `esbuild` advisory. Dev
dependency only, never shipped, and resolvable when drizzle-kit updates.

### Two findings from the live Supabase environment

**Email confirmation is on in `forjd-dev`** (`mailer_autoconfirm: false`). Registration
therefore creates the account but issues no session, and the subsequent login fails with
"Email not confirmed" until the emailed link is clicked. This is correct production
behaviour and the API models it honestly — `signUp` returns a nullable session rather
than pretending one exists. But it makes the dev loop awkward: every test account needs a
real inbox. Consider turning "Confirm email" off in the **dev project only**
(Authentication → Providers → Email). Staging and prod are separate projects, so dev
convenience costs production nothing.

**The direct Postgres connection is unreachable from this machine.**
`db.<ref>.supabase.co` resolves only to IPv6, and this network has no IPv6 route — the
router hands out ULA (`fd8c:…`) addresses with no upstream. Use the **Session pooler**
string (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`), which is IPv4. Session
mode, not transaction mode: drizzle-kit migrations need prepared statements. This blocks
nothing today because migrations run against local Postgres first by design (ADR-002); it
matters when the hosted database is first migrated in slice 13.

### Repo

- Skeleton created at `C:\Users\Mostafa Ashraf\Desktop\FORJD`: `CLAUDE.md`,
  all 7 ADRs, `docs/product/*`, `docs/architecture/*`, root config
  (`.gitignore`, `pnpm-workspace.yaml`, `docker-compose.yml`, `README.md`).
- ✅ **Committed and pushed** to https://github.com/Menshawy97/FORJD.
  Local git identity is set per-repo (`--local`) to Mostafa Menshawy /
  mostafa.menshawy97@gmail.com. All commits are authored under that identity —
  keep it that way; do not add other co-authorship trailers.
- `apps/api` and `apps/mobile` both have real, tested application code now (see
  "Current status" above) — this line describing them as empty placeholder
  directories was a stale carryover from the repo's very first skeleton commit,
  left uncorrected through an earlier exploration pass, and is corrected here.

### Toolchain — installed and verified on this machine

| Tool | Status | Detail |
|---|---|---|
| Node.js | ✅ Done | v24.19.0 LTS via winget |
| pnpm | ✅ Done | v11.22.0 via `npm install -g` (corepack was blocked by non-admin `Program Files` write — worked around, don't re-attempt corepack) |
| GitHub CLI | ✅ Done | v2.97.0 via winget |
| git long paths | ✅ Done | `git config --global core.longpaths true` |
| Flutter | ✅ Done | 3.47.0 stable / Dart 3.13.0, cloned to `C:\dev\flutter`, on User PATH, analytics disabled |
| Android Studio | ✅ Done | App installed via winget. SDK GUI wizard was skipped — provisioned headlessly instead (see below) |
| Android SDK | ✅ Done | At `C:\Android\Sdk` (moved from the default `%LOCALAPPDATA%` path because it contained a space in the Windows username, which breaks NDK tooling). platform-tools, `platforms;android-34`, `platforms;android-36`, `build-tools;36.0.0`, all licenses accepted. `flutter config --android-sdk` points at it. |
| `flutter doctor` | ✅ Clean | Android toolchain green. Only remaining flag is "Visual Studio not installed" — **ignore this**, it's for Windows desktop apps, not a FORJD target platform. |
| Docker Desktop | ✅ Done | WSL2 enabled via the elevated setup script + reboot. `docker-compose up -d` brings up `forjd-postgres` (5432) and `forjd-redis` (6379), both reporting healthy. |
| Android emulator | ✅ Done | AVD `forjd_pixel7_api34` — Pixel 7, Android 14, **Play Store** image (so Health Connect works on it in Phase 6), 4 GB RAM, hardware keyboard. Launch with `-gpu host`; the software renderer ANRs SystemUI at this resolution. WHPX acceleration confirmed usable. |
| Physical Android device | ⚠️ Not connected | Needs USB with debugging enabled; `flutter devices` will pick it up. The emulator covers UI work, but not real health data, a hardware-backed keystore, WHOOP, the camera, or gym use — so this is still required before Phase 6 and for slice 14. |

### Manual steps only the user can do (genuine hard stops — need a UAC click, physical hardware, a credential, or human judgement)

Steps 1-4 of the original list (elevated setup script, reboot, Docker first-run,
git identity + initial commit) are **done**. What remains:

1. ⬜ **Plug in the physical Android device**, confirm with `flutter devices`. No longer blocks UI work — the emulator covers that — but still required for slice 14 and anything touching Health Connect (rule 16, ADR-007).
   Needed from week 1 — Health Connect is a system component and gym testing
   needs real hardware, not an emulator.
2. ⬜ **Set `ANTHROPIC_API_KEY` to run Spike B.** No credential exists on this
   machine (no env var, no `~/.config/anthropic` profile, no `ant` CLI), and an
   agent must never be handed the key — set it yourself in your own shell:
   ```powershell
   $env:ANTHROPIC_API_KEY = "sk-ant-..."
   ```
3. ✅ **`forjd-dev` Supabase project — done.** Email/password auth enabled, `inbody`
   bucket created, credentials in the gitignored `apps/api/.env`. Verified working:
   auth and storage endpoints respond, and a real registration round-tripped.
   ✅ **Decided — [ADR-015](../decisions/ADR-015-supabase-topology-and-free-host.md).**
   `forjd-prod` (new) is production, confirmation-on. `forjd-dev` (existing) is repurposed
   as **staging**, brought in line with prod's confirmation-on config. Local development
   moves to the Supabase CLI Docker stack, which is what frees the third slot. `forjd-prod`
   is the one genuinely new project to create — creating it is what unblocks slice 12.
4. ✅ **Decided — [ADR-015](../decisions/ADR-015-supabase-topology-and-free-host.md).**
   **Google Cloud Run** hosts `apps/api` (staging first, production once it exists), chosen
   over Render/Koyeb for its much shorter cold start (~1-2 s vs. a sleeping free-tier
   instance's wake time) and a real scale-up path with no later hosting migration — decisive
   given a release build has to survive App Store/Play Store review and early real users,
   where a slow or timed-out first request is a real risk, not a rare one. Needs a Google
   Cloud project and a card on file (even at $0 usage under the free tier) — the same
   category of manual step as creating `forjd-prod`.
5. ⬜ **Shorten the access-token lifetime to 900 seconds** (Supabase dashboard →
   Authentication → Sessions), in `forjd-dev` and in every project created later. Since
   ADR-012 this value is the session revocation window, not a convenience setting: it is how
   long a signed-out or deleted account's token keeps working. It is 3600 s today. The mobile
   client refreshes transparently on a 401, so users notice nothing.
6. ⬜ **Hand-label Spike B ground truth.** This one is not automatable *in
   principle*, not just in practice: if the same model that extracts the values
   also writes the answer key, the accuracy number measures self-consistency
   rather than correctness — and it fails silently, looking like a clean result.
   Read each sheet yourself. See `scripts/spikes/README.md`.

### Spike status

| Spike | Status | Detail |
|---|---|---|
| A — exercise dataset | ✅ **Decided.** ADR-005 Accepted | `free-exercise-db` chosen (~870 exercises, Unlicense/public domain, zero attribution or share-alike obligations). `wger` rejected for now — its data is CC-BY-SA and the share-alike implications for a closed-source paid app are an **open legal question**; fold that into the lawyer conversation before ever ingesting wger content. `exercisedb.io` ($299+, richest taxonomy) deferred as a future paid upgrade. |
| B — InBody vision | 🟡 **OPEN — tooling built, blocked on the two manual steps above** | Harness complete and smoke-tested at `scripts/spikes/`: `inbody-vision.ts` (Claude vision → structured JSON with per-field confidence) and `score-inbody.ts` (per-field accuracy, confidence calibration, high-confidence-error count). ~20 photos are staged in the gitignored `scripts/spikes/inbody-samples/photos/`. **Nothing has been measured yet** — ADR-006 stays Proposed until it has. |
| C — iOS pipeline | ⬜ Not started | Gated on Apple Developer *organization* approval. Explicitly not a Phase 0 blocker; track as an open checkpoint through Phase 1. |

### Phase 0 items not yet started (calendar/business — only the user can act)

- Business entity registration, D-U-N-S number
- Google Play Console + Apple Developer *organization* accounts
- Legal engagement for privacy policy / ToS — **add the wger CC-BY-SA share-alike
  question to this engagement** (see ADR-005), alongside health data categories,
  InBody images, third-party AI processing, and location/leaderboard consent

### Next action once resumed

**SUPERSEDED (2026-08-24): Phase 1 is now complete** — slices 12, 13 and 14 all landed, so
the deployment work and manual account-creation steps this paragraph treated as outstanding
are done. See "Current status" at the top of this file.

What remains true and still matters: **Phase 2 has no blocker.** Its opening slices are
shaped as canonical exercise model + ingest, browse/search API, then an on-device catalogue
with local FTS5 search — see the "Working method" note at the bottom of this file for why
later phases are re-planned rather than executed from the original outline.

**RESOLVED (2026-08-24): the Phase 2 re-plan is done and committed.** The re-plan sketched in
an earlier session had never been transcribed and its context was gone, so it was redone from
scratch. It now lives at [`docs/product/phase-2-plan.md`](phase-2-plan.md), with
[`docs/design/phase2-screen-specs.md`](../design/phase2-screen-specs.md) and
[ADR-018](../decisions/ADR-018-exercise-media-hosting.md) alongside it — that is Phase 0 of the
plan, and it is complete. Start at the plan's Phase A.

Nothing is half-finished. Slice D closed the last item that was both unblocked and open;
there is no more free-standing hardening work sitting undone the way there was before the
A-D batch.

### Next, in order

0. **Slice 2 of the Expo rebuild — profile/settings screens + the backend behind them.**

   **Status: DONE. All mobile phases — G (`editProfile` + `units`), H (`location` +
   `goals`), I (`privacy` + `notifs`) and J (`athlete` + wiring `profile` to real data) —
   are merged and green on `main`, alongside backend phases A–F. Slice 2 is closed.**

   Read, in this order, before writing any screen:
   - **`docs/product/slice-2-plan.md`** — locked decisions (do not re-litigate — see its
     table), phase-by-phase build order, verification steps. Phases A–J are all marked done
     inline with what they produced; slice 2 is closed.
   - **`docs/design/slice2-screen-specs.md`** — every value (copy, typography, colour,
     spacing, states) extracted from the runnable prototype
     (`FORJD mobile app design/FORJD Mobile.dc.html`) for all six screens plus `athlete`.
     Its header box records which of its own open questions have since been answered —
     that box wins over the body where they disagree. **Trust the prototype over the
     `design_handoff_forjd_mobile/*.md` summaries**, which disagree with it in ten places.

   **What the backend gives every remaining phase to build against** (all live on `main`,
   verified end to end by 161 unit + 30 e2e tests):
   - `GET /api/v1/users/me` → `{ id, email, profile, privacy }` in one read. `profile` carries
     name/DOB/sex/height, the three real unit preferences (`weightUnit`/`distanceUnit`/
     `energyUnit` — **not** the deprecated `unitSystem`, see ADR-016), `trainingGoals`/
     `activities` arrays, `city`, `avatarUrl`, and a hardcoded `plan: 'free'`. `privacy`
     carries all six consent flags, every account starting all-**off**.
   - `PATCH /api/v1/users/me/profile` → any subset of the writable profile fields above
     (`city` included; `citySlug`/`plan` are server-derived, never client-writable).
   - `PATCH /api/v1/users/me/privacy` → any subset of the five flags. Turning
     `leaderboardOptIn` off cascades `locationForLeaderboard` off; turning the latter on
     without the former is a `400`.
   - `GET /api/v1/athletes/:userId` → the public projection (identity + goals/activities/
     city only, no stat tiles — those need Phase 10). Refusal is always `404`, indistinguishable
     between "no such user" and "private profile." Self-view (`isSelf: true`) bypasses the
     flag, which is what backs the design's "Preview my public profile" row.

   Full wire contract: `packages/contracts/src/index.ts`. A worked example of every response
   shape, including the empty/first-run states: `packages/contracts/fixtures/*.json` — these
   are real parsed output, not hand-written samples, so they cannot drift from the schema.

   **What phases G and H already established — reuse, don't rediscover:**
   - **Auth gating.** `_layout.tsx`'s `AuthGate` is an explicit `PUBLIC_ROUTES` allowlist
     (`welcome`/`login`/`signup`), not a `(tabs)`-only denylist — every new top-level route
     is automatically covered, no per-screen wiring needed.
   - **CI runs in UTC.** Any date-parsing regression test must assert against
     `new Date(y, m, d)` directly (or otherwise be timezone-construction-independent), not
     `getUTCHours() !== 0` — that check only fails on a non-UTC dev machine and is a
     false-negative on CI. (Bit Phase G once; fixed forward.)
   - **`unitSystem` vs. the real fields.** Bind to `weightUnit`/`distanceUnit`/`energyUnit`
     for anything unit-related. `unitSystem` still exists on the response (deprecated) but
     the pinned fixture deliberately pairs `unitSystem: metric` with `weightUnit: lb` to
     catch a client that reads the wrong one.
   - **Navigation-state query params.** `goals`/`location` port the prototype's
     `goalsReturnTo`/`locationReturnTo` as plain query params (`returnTo`, `back`) rather
     than app state — `03-navigation.md`'s stack-depth version was deliberately not ported.
     Follow the same pattern for any screen with more than one entry point.
   - **`components/tab-bar.tsx`.** A presentational copy of the `(tabs)` bottom bar, for
     screens outside that group that still need to show one (`location` is the first).
     Reuse it rather than writing a second copy.
   - **Web preview is broken for authenticated screens.** `expo start --web` fails before
     render on anything that calls `getMe()` — `expo-secure-store`'s web build isn't
     resolving in this Metro/pnpm setup (pre-existing, not chased down). Unauthenticated
     screens (welcome/login/signup) still preview fine on web. For anything behind auth,
     verify via the LAN Expo Go connection instead (`exp://<machine-LAN-IP>:8081`, manual
     entry — `--offline` suppresses the printed QR).

   **Two deliberate deviations from the prototype, already decided — apply without asking:**
   - In `notifs`/`privacy`, make the **whole row** tap-to-toggle, not just the 46×27 track —
     accessibility minimum tap target (see `slice2-screen-specs.md` §9).
   - `location` is built but not yet linked from anywhere (`rank` is still a placeholder,
     `privacy` doesn't exist yet). It takes an optional `?back=privacy` param — Phase I's
     privacy screen should link to it as `/location?back=privacy`.

   **Genuinely open, not backend-blocking — surface if hit, don't guess:**
   - RLS still isn't configured on any table. Needs a human decision (build it, or correct
     rule 12's docs) — unrelated to slice 2 and not something a mobile phase should resolve.
   - Energy default (`kcal`) and the `Analyse`/`programs` copy-locale inconsistency are both
     open product/content calls, not backend gaps — see `slice-2-plan.md`'s still-open list.
   - `heightCm` has no screen and already round-trips through the API correctly for whichever
     future screen adds it. **`avatarUrl` now DOES have a control** — the 2026-08-30 revision
     added upload affordances to `pickUsername` and `editProfile` (ADR-019). Note the field's
     current contract accepts only an external `http(s)` URL and there is no upload endpoint,
     so the app cannot yet produce a value for it.

   **`docs/product/ui-remediation-and-phase-i-plan.md`** — a written, approved,
   self-contained plan covering two PRs, in order. **Both parts are done, merged, and green
   on `main`.**

   1. **DONE — Fidelity/navigation remediation on already-shipped screens.** Fixed the
      swipe-back navigation bug (`welcome` was never popped by the post-login `replace`, so
      the stack sat at depth 2 forever and swiping back landed on it looking like a
      sign-out) — `login`/`signup` now `dismissAll()` before replacing, and `_layout.tsx`
      gained an `AuthenticatedGate` safety net that redirects an authenticated user away
      from `welcome`/`login` (deliberately excluding `signup`, which the goals-screen
      back-chevron trap still needs reachable). Also fixed: the Save-button glow (four
      screens' opaque `shadowColor` inline was fighting the translucent `shadow-primary-
      button` token; added a deliberate Android `elevation` theme block so NativeWind stops
      inferring one from blur radius), the ghost-button pressed transform the design does
      not have, the missing Google/Apple social auth row on `login`/`signup` (new
      `components/social-auth-row.tsx`, inert — no OAuth backend yet), the `@jmitch` handle
      that contradicted a shipped decision (now shows city alone — **this particular fix is
      itself reverted by the 2026-08-30 design revision; see ADR-019**), and three `goals.tsx`
      token/color deltas. Also picked up from live device testing mid-PR: the Birthday row
      on `editProfile` had no visual tap affordance (added the same trailing `chevron` icon
      `profile.tsx`'s settings rows already use), and `editProfile`/`units` are now
      `ScrollView`-wrapped rather than a fixed `View`, as a defensive fix against content
      overflowing short screens.
   2. **DONE — Phase I — `privacy` + `notifs`.** Both shipped with the whole-row-toggle
      deviation applied, and `privacy`'s location row links to `/location?back=privacy`,
      finally making Phase H's param real. `privacy` mirrors the server's
      leaderboard/location dependency in both directions so its 400 is unreachable;
      `notifs` is device-local via AsyncStorage behind `store/notification-preferences.ts`,
      with no Save button. Two reusable components came out of it —
      `components/toggle.tsx` and `components/toggle-row.tsx`. See `slice-2-plan.md`'s
      Phase I entry for the full decision record.

      One cross-cutting lesson worth carrying forward: **put box-model properties
      (height/border/background/flex-direction/radius) in NativeWind `className`, not in a
      raw inline `style` callback on a `Pressable`.** The social auth row was built the
      latter way in Part 1 and rendered correctly on web but visibly broken on a physical
      iOS device; rewriting to `className` (keeping only the dynamic pressed background in
      the `style` callback) fixed it. Every component added in Phase I follows that
      convention.

   **DONE — Phase J — `athlete` screen + wire `profile` to real `/users/me` data.** New
   dynamic `app/athlete/[userId].tsx`, backed by the already-built `GET /athletes/:userId`.
   Ships identity only (no stat tiles/records/sessions — Phase 10 data; **still correct after
   the 2026-08-30 revision, which draws them — the data genuinely does not exist, so they stay
   omitted rather than faked**), no handle line (**this part is overturned: ADR-019 brings the
   handle back, and the screen's header comment saying otherwise must be rewritten when it is
   next touched**), and one generic error state for any load failure rather than the
   prototype's stranger-specific "this profile is private" copy — the backend deliberately
   makes a private profile and a nonexistent one return byte-identical 404s (accounts hold
   health data; a distinguishable refusal is an enumeration oracle), so reproducing that copy
   client-side would leak exactly what the backend refuses to leak. The self-view "your
   profile is private" nudge is a different case and does render: self always gets data back
   regardless of the flag, so `privacy.tsx`'s "Preview my public profile" row carries the
   current `publicProfile` value as a `?publicProfile=` query param (the response itself
   never includes privacy flags, by design).
   `(tabs)/profile.tsx`'s identity block and its Goals/Units row subtitles now read
   `getMe()` instead of the hardcoded `IDENTITY` object — the "James Mitchell" placeholder
   flagged since Phase G is gone. `plan` stays the literal "Free User": `PLANS` is a
   one-member tuple until billing (Phase 10). **ADR-021 adds a second member** so the Pro
   badge the design draws is representable — UI only, nothing gated or charged. Unlike every sub-screen in this app, the render
   is not gated behind a `loaded` flag — profile is a persistent bottom tab, so static/inert
   rows and sign-out stay usable immediately while only the dynamic identity bits show a
   `'—'` fallback until the fetch resolves.

   **This closes slice 2.** Phases A through J are all done, merged, and green on `main`.

1. ✅ **Supabase topology and free host — decided, [ADR-015](../decisions/ADR-015-supabase-topology-and-free-host.md).**
   `forjd-prod` + Cloud Run + local Docker dev, `forjd-dev` repurposed as staging. Not yet
   *created* — see next steps.
2. ✅ **Slice 12 — build flavors.** `apps/mobile/eas.json` now defines three EAS Build
   profiles — `development` (internal, `developmentClient: true`, `API_BASE_URL` defaults to
   the local Docker API at `http://localhost:3000`), `staging` (internal distribution,
   `staging` update channel, points at the not-yet-deployed Cloud Run staging URL), and
   `production` (`autoIncrement`, `production` channel, points at the not-yet-deployed Cloud
   Run production URL). `app.config.ts` already read `process.env.API_BASE_URL` into
   `extra.apiBaseUrl` before this slice (Slice 1); the only gap was the EAS profiles that set
   that env var per build target, which this closes. `eas-cli` is now a devDependency
   (`pnpm build:development` / `:staging` / `:production` scripts added to
   `apps/mobile/package.json`).

   **The `staging` profile now points at the live deployed API** —
   `https://forjd-api-staging-772363715082.us-central1.run.app`, verified serving
   `{"status":"ok","database":"up"}`. **`production` is still a literal
   `REPLACE_WITH_CLOUD_RUN_URL` placeholder**, because no production Cloud Run service
   exists yet; fill it in when prod is deployed (the service will be named
   `forjd-api-production`, so the URL follows the same
   `https://<service>-<project-number>.<region>.run.app` shape).

   **EAS is linked.** `eas login` + `eas init` were run manually; `app.config.ts` now carries
   `owner: 'forjd'` and `extra.eas.projectId`. The project lives under the **`forjd` org**
   account, not a personal one.
3. ✅ **Slice 13 — deploy staging to Cloud Run. DONE — staging is live.**
   `https://forjd-api-staging-772363715082.us-central1.run.app/api/v1/health` returns
   `{"status":"ok","database":"up"}`, which proves the container serves traffic *and* reaches
   the forjd-dev Postgres through the session pooler. GCP project `forjd-506508`
   (number `772363715082`), region `us-central1`.

   **Confirmed Supabase project refs** (from the management API, so these are authoritative —
   they were mixed up once during setup and cost real time):
   - `wzjireraquxtyhbzvkfw` = **forjd-dev** → serves as **staging**, region `eu-west-1`
   - `lzhwyvrtkmgtjruvjins` = **forjd-prod**, region `eu-west-1`

   **Five failures stood between "pipeline written" and "staging live." Every one of them
   will recur when production is set up — read this list before doing prod:**
   1. **The direct connection string is IPv6-only and unusable.** `db.<ref>.supabase.co`
      fails with `getaddrinfo ENOENT` from both a Windows dev machine and GitHub runners.
      Supabase's paid IPv4 add-on is *not* needed and *not* the answer — the **session
      pooler** (`postgres.<ref>@aws-1-<region>.pooler.supabase.com:5432`) is IPv4 and free.
      Use the dashboard's copy button on the Session pooler tab; do not hand-assemble it.
   2. **`drizzle-kit migrate` swallows every connection error.** Its spinner overwrites the
      error text with `\r`, so CI logs and local terminals alike show a bare exit 1 with no
      message. Three separate debugging attempts learned nothing from it. A ten-line script
      using `pg`'s `Client` directly prints the real error (`ENOENT`, `28P01`, etc.) and is
      the fastest way to diagnose any future connection problem — write one, use it, delete it.
   3. **Supavisor caches credentials after a password reset.** A correct password can fail
      with `28P01 password authentication failed` for a minute or two afterwards. Retry
      before concluding the password is wrong — this cost an entire debugging detour into
      project refs, regions, and URL-encoding that were all fine.
   4. **The Cloud Run *runtime* service account is not the deploy service account.** Granting
      `roles/secretmanager.secretAccessor` to `forjd-deployer` is not enough; the revision
      runs as the default compute SA (`<project-number>-compute@developer.gserviceaccount.com`)
      and needs its own grant on each secret. Done per-secret rather than project-wide to keep
      the grant scoped. *(Hardening left undone: a dedicated minimal runtime SA via
      `gcloud run deploy --service-account` would be better than reusing the default compute
      SA. Not blocking; worth doing before production carries real user data.)*
   5. **PowerShell is not bash, and `--set-secrets` mounts raw bytes.** Secrets created with
      bash idioms (`echo -n "..." | gcloud ...`) in a PowerShell session get a literal `-n`
      and/or a trailing `CRLF` baked into the value. This stayed invisible through the
      migration step — which reads secrets via bash `$(...)`, stripping trailing newlines —
      and only surfaced at container start as
      `Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL`. Write secret values with
      `[System.IO.File]::WriteAllText($path, $value, [System.Text.UTF8Encoding]::new($false))`
      and `gcloud secrets versions add --data-file=$path`. **Development on this project
      happens on Windows/PowerShell — any manual command handed to the operator must be
      PowerShell syntax, not bash.**

   **Custom SMTP is required before beta, and is not optional.** Supabase's built-in mailer
   is a development convenience capped at roughly **2-4 emails per hour per project**. With
   email confirmation on (ADR-015), every signup sends mail, so the cap *is* the signup
   ceiling. This was hit within minutes during the slice 14 walk: registration began failing
   with `email rate limit exceeded` after three accounts. For real users this is
   indistinguishable from the app being broken — the third person to sign up in an hour never
   receives their confirmation link. Connect a real provider (Resend, SendGrid, Postmark —
   all have free tiers in the thousands/month) in **Authentication → Emails → SMTP Settings**,
   for `forjd-dev`/staging and `forjd-prod` alike. It is a project setting, not a code change.

   **What production still needs** (deliberately not done yet — staging first, then the
   slice 14 device walk, then prod as its own careful step):
   - `forjd-production-database-url` **is currently wrong**: it was seeded by copying the
     staging secret back when that held prod's values, so it carries forjd-prod's *direct*
     (IPv6) connection string. It needs forjd-prod's **session pooler** string
     (`postgres.lzhwyvrtkmgtjruvjins@aws-1-eu-west-1.pooler.supabase.com:5432`).
   - The same three `secretAccessor` grants to the runtime SA, on the `forjd-production-*`
     secrets.
   - A `production` GitHub environment, and `apps/mobile/eas.json`'s `production`
     `API_BASE_URL` filled in once the service exists.

   **How the pipeline is built:**
   `apps/api/Dockerfile` is a three-stage build — `pnpm fetch` (lockfile-only, cacheable),
   `build` (`pnpm --filter @forjd/api... run build` then `pnpm --filter @forjd/api deploy
   --prod --legacy /workspace/deploy`, isolating just `@forjd/api`'s production dependency
   tree — none of `apps/mobile`'s React Native deps reach the image), and a `node:22-slim`
   `runtime` stage that copies only `dist/`, `node_modules/`, and `package.json` out of the
   deploy bundle. **Built and run locally this session** (`docker build` succeeded; the
   container booted Nest cleanly and failed only on the expected missing `SUPABASE_URL` —
   proof the image resolves modules correctly, not proof it's deployed). `pnpm deploy`
   needed `--legacy`: pnpm v10+ defaults to requiring `inject-workspace-packages=true`,
   which this workspace doesn't set.

   `.github/workflows/deploy-api.yml` builds the image, runs `pnpm --filter @forjd/api
   db:migrate` against the **session pooler** connection string (not the direct one — the
   IPv6 finding below), and `gcloud run deploy`s it. It triggers on `workflow_run` after `CI`
   goes green on `main` (same "green run, not green PR" discipline as the standing post-merge
   rule) or manually via `workflow_dispatch` with a `staging`/`production` target.

   **The GCP/GitHub setup behind it, all now done for staging:**
   - `forjd-deployer@forjd-506508.iam.gserviceaccount.com`, authenticating from GitHub
     Actions via Workload Identity Federation — no long-lived JSON key is stored anywhere.
   - Repo *variables* (not secrets — none of these is a credential): `GCP_PROJECT_ID`,
     `GCP_REGION`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`.
   - Three Secret Manager secrets per target: `forjd-<target>-database-url`,
     `forjd-<target>-supabase-url`, `forjd-<target>-supabase-service-role-key`.
   - An Artifact Registry Docker repo named `forjd` in `us-central1`.

   The workflow's `check` job verifies all four repo variables are present and **skips the
   deploy job cleanly when they are not**, so a repo without GCP configured gets a green
   skip rather than a red failure on every push to `main`.
4. ✅ **Slice 14 — the definition-of-done walk on the physical device. DONE — Phase 1 is
   closed.** Walked on a physical iPhone via Expo Go against **deployed staging** (not a
   local API), 2026-08-24. Every step of Phase 1's definition of done passed:
   cold start → `/welcome`; register → "check your inbox" → confirm via the real email link;
   login → `/home`; all five tabs holding their own scroll position; profile showing the
   registered name; edit → save → persisted; units/goals/privacy/notifs all opening and
   saving; `privacy` → "Preview my public profile" → athlete screen; kill-and-relaunch while
   signed in → straight to `/home`; logout → `/welcome`; relaunch after logout → stays on
   `/welcome`.

   **The refresh path was exercised for real, and this is the first time that has ever been
   true.** Left signed in and idle past the 900 s access-token lifetime (ADR-012), then
   reopened Profile: it loaded normally, no bounce to `/welcome` — the silent
   401 → refresh → replay working on a device. Both the slice 11 and slice B walks had to
   record this as untested, because with a 3600 s token there was no way to produce a
   rejected access token by hand.

   **Two findings came out of the walk, both fixed and merged (PR #33):** a Supabase mail
   rate limit reaching the user as "Please try again" when retrying could not work for an
   hour (now a 429 with a wait message), and the mobile client discarding the server's
   message for every non-offline failure (now surfaced for 400/429, never for 401). A third
   change rode along: `@expo/ui` and `@expo/log-box` — SDK-57 packages in an SDK-54 app,
   imported by nothing — were removed. They pulled a second `react-native` (0.86.2) into the
   store that Metro crawled into and reported as
   `Unable to determine event arguments for "onModeChange"`. **That error was noise, not
   breakage** — the bundle built fine throughout (verified HTTP 200, 9.8 MB) — worth knowing
   before anyone chases it again.

**All manual account/credential setup is done** — both Supabase projects, the Google Cloud
project, the deploy service account, Workload Identity Federation, Secret Manager, Artifact
Registry, and EAS.

**Phase 1 is complete. The next action is to re-plan Phase 2 (exercise database) and write
that plan into this file before writing any Phase 2 code** — that sequencing is a standing
rule here, not a formality. Phase 2 should be re-planned rather than executed
from the outline — later phases were deliberately left thin so earlier ones could teach their
lessons, and slice 11 taught several worth carrying forward: mirror provider-side constraints
in the contract, walk a flow live before believing it, and prefer a test that has been shown
to fail against the unfixed code.

### The slice B walk (2026-08, after ADR-012)

Token verification changed, so the walk was repeated on the same emulator. **Nothing broke
and no new findings came out of it**, which is the honest result rather than a disappointing
one — the change was server-side and the mobile client never knew.

Confirmed on device against the local API and live Supabase: register with a name → straight
into `/home`; the five-tab shell; the name reaching `/users/me` through the rewritten guard;
edit → save → `PATCH` persisting (checked in Postgres, not just on screen); a cold restart
while signed in going straight to `/home` with no welcome flash; log out returning to
`/welcome`; and a cold restart after logout staying on `/welcome`.

**Not covered, and worth being precise about:** the 401 → refresh → replay path was *not*
forced on device. Doing so needs an access token the server will reject while the refresh
token still works, and there is no way to produce one by hand — the stored token is
encrypted by `flutter_secure_storage`, and corrupting the ciphertext produces a failed
read rather than a rejected token. It is covered by `auth_interceptor_test.dart`, including
the single-flight property. The natural way to exercise it on a device is after the
access-token lifetime is shortened (see the manual steps), when it can simply be waited out.

### Re-running the slice 11 verification

This has been done once (see "The emulator walk"). Keep it as the procedure to repeat
after any change to the auth or profile UI.

```bash
docker compose up -d
pnpm install && pnpm -r build
pnpm --filter @forjd/api test && pnpm --filter @forjd/api test:e2e
bash scripts/ci/check-architecture-conformance.sh
pnpm --filter @forjd/api start:dev
```

```bash
cd apps/mobile
flutter run -d <emulator> --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

The walk that proves it: cold start → splash → welcome; register with a name → the
"check your inbox" panel; log in → `/home`; move through all five tabs and confirm each
keeps its own scroll position; profile shows the registered name; edit → save → survives
a reload; forgot-password → "check your email"; log out → `/welcome`; **kill and relaunch
while logged in → straight to `/home` with no welcome-screen flash** — that last one is
the `AuthUnknown` state doing its job.

Refresh-and-replay is invisible in a normal walk. Force it: corrupt the stored access
token, open the profile screen, and confirm **exactly one** `/auth/refresh` in the API log
followed by a successful `/users/me`. Then corrupt the refresh token and confirm the app
lands back on `/welcome`.

**SUPERSEDED (2026-08-24): email confirmation is now ON in `forjd-dev`.** It was off while
`forjd-dev` served as the dev project, which is what let register → login be walked without
a real inbox. Under ADR-015 `forjd-dev` is **staging** and must behave like production, so
confirmation was turned on deliberately. The "check your inbox" panel is now the *expected*
result of a register walk — not a sign something broke. Local development runs against the
Supabase CLI's Docker stack instead, which is where a no-inbox round-trip belongs now.

Passwords must satisfy the policy: 8+ characters with an uppercase, a lowercase, a digit,
and a symbol from Supabase's set — a space does not count. `Str0ng!Pass1` works.

Spike B remains open and is worth finishing — Phase 5 is designed around its
answer — but it does not block anything in Phase 1. Set `ANTHROPIC_API_KEY`, run
`pnpm extract`, hand-label truth, run `pnpm score`, then fill in ADR-006's
Consequences table and flip its Status to Accepted (or, if confidence turns out
not to correlate with real errors, record that the confidence gate is decorative
and needs redesigning — that is a legitimate and valuable spike outcome, not a
failure).

## Timeline (~38 weeks to Android beta, dual-platform public launch)

| Phase | Weeks | Focus | Status |
|---|---|---|---|
| 0 — Setup & decisions | 1-3 | Toolchain, accounts, repo skeleton, 3 spikes, business entity | Complete except Spike B |
| 1 — Foundation | 4-6 | AuthProvider/StorageProvider, users/profile, CI, flavors | **Complete** |
| 2 — Exercise database | 7-9 | Ingest dataset, canonical model, browse/search | **Complete** — [re-planned](phase-2-plan.md); all phases (0, A-K) done, screen work complete |
| 2.5 — Nutrition | +3 | Food database, logging, saved meals, macro goals | **Complete** — [planned](nutrition-plan.md); Phases A-J done, and Phase I (the Home entry-point card) shipped as part of the Home dashboard |
| 3 — Walking skeleton | 10-15 | Templates, sessions, offline-first execution | Not started — [planned](phase-3-plan.md) |
| Dogfood gate | 16-17 | Real training with the app | Not started |
| 4 — Programs | 18-21 | Program/week/day, enrollment, progression | Not started |
| 5 — InBody | 22-24 | Upload, Claude extraction, confirmation, BullMQ | Not started |
| 6 — Health Connect + analytics | 25-28 | HealthProvider, aggregation, dashboards | Not started |
| 7 — WHOOP | 29-30 | OAuth, webhooks, adapter | Not started |
| 8 — Privacy & beta prep | 31-34 | Legal, consent, Play closed testing clock | Not started |
| Limited Android beta | 35 | 12+ testers | Not started |
| 9 — Post-beta iteration | 36-39 | Fix what beta reveals | Not started |
| 10 — Leaderboards + subscriptions | 40-46 | CityResolver, ScoringStrategy, RevenueCat | Not started |
| 11 — iOS track (parallel with 10) | 40-46 | AppleHealthProvider, Codemagic, TestFlight → App Store | Not started |
| Dual-platform public launch | ~47 | Both stores | Not started |

## Decisions that shaped this sequencing

See the plan file's §1 (decisions D1-D9) and the ADRs in `docs/decisions/`
for the reasoning — most notably ADR-007, which is why Health Connect ships
before Apple Health and iOS runs as a parallel track rather than earlier.

## Working method

Every phase executes as vertical slices, never "build feature X" in one
shot. See `CLAUDE.md` for the rules this is checked against. At the start
of each phase, re-read this roadmap and the plan file's phase outline
before writing the phase's detailed task breakdown — later phases are
intentionally left as an outline to re-plan once earlier phases have taught
their lessons.

<!--
CI note: documentation-only changes skip the suite entirely (`paths-ignore` in
.github/workflows/ci.yml), on pull requests and on main alike. A merge like that produces
no run, which is intended rather than a trigger that failed. A change touching both a doc
and a source file still runs everything.
-->
