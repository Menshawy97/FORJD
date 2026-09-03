# Phase 3H — live execution: implementation plan

Written 2026-09-02, before any code, per the standing "plan first" instruction.
[`phase-3-plan.md`](phase-3-plan.md) describes Phase H in one paragraph; this document is the
executable plan for it. It exists because reading the actual design sources turned that
paragraph out to be **materially wrong about where the design lives**, and because the screen
is several times larger than "the live screen plus a rest timer".

## Correction: there is no `s_live()`

`phase-3-plan.md` names the design source as the prototype's `s_live()`. **No such function
exists.** A repo-wide search of `FORJD mobile app design/FORJD Mobile.dc.html` finds 44
`s_*()` screen functions, and `live` is not among them.

`live` is one of nine **template-rendered** screens, listed in `renderVals()`:

```js
const TMPL=['loading','welcome','home','progress','progressBody','progressRec','live','rank','profile'];
```

Those screens are authored as declarative HTML with `{{ }}` bindings inside the document body,
not as `h()` calls in a function. So the authoritative prototype sources for this phase are:

| What | Where |
|---|---|
| **Live screen markup** | the `<sc-if value="{{ isLive }}">` block, from ~line 504 |
| **Live screen view-model** | `renderVals()`'s live branch, ~line 3423 — every binding the markup consumes |
| **Session/timer logic** | `componentDidMount()`'s 1 s interval (~line 1003), `tapSet` (~1041), `editSet`, `openSetTimer`, `completeTimedSet`, `removeSet`, `removeExercise`, `cancelWorkout`, `togglePause` (~1041–1094) |
| **Rest screen** | `s_rest()` — this one *is* a function, ~line 2067 |
| **Timed-set screen** | `s_setTimer()` — also a function, ~line 3121 |

**Screenshots outrank all of the above** (standing precedence). Both exist and were read while
writing this plan: `screenshots/live workout.png` (weight measure) and
`screenshots/live workout 2.png` (time and distance measures). They disagree with nothing in
the prototype, but they are far more legible about layout, and they are the reference to build
against.

## What the screen actually contains

From the two screenshots, top to bottom. This is the honest inventory — `phase-3-plan.md`'s
one-liner covers roughly the first third of it.

**Header block**
- Pulsing orange dot + `LIVE · UPPER BODY PUSH` (`liveTitle` is `'Live · '`/`'Paused · '` +
  the session name).
- Large elapsed time (`0:04`), tabular numerals.
- Three controls: a red **✕** (cancel), **Pause**, and an orange **Finish**.
- Progress bar + `2/12 sets` + `1,280 kg` running volume.

**Watch card** — red pulsing dot, `WATCH`, `145 bpm`, `142 avg`.

**"How to train this"** — collapsible, subtitle `Bench Press · Strength`, expanding to the
goal guide table (load / reps / rest / execution per goal, with a `THIS LIFT` badge on the
current exercise's goal).

**Rest timer card** — "Applies to every set in this workout", a `− 1:30 +` stepper (90 s
default, ±15 s).

**One card per exercise**
- Name, a unit pill (`KG` / `M`), a chart icon (→ exercise detail), an **✕** (remove from this
  session only).
- A goal chip (`STRENGTH ▾`, `HYPERTROPHY ▾`, `MUSCULAR ENDURANCE ▾`) opening a goal picker
  with an "apply to all" option.
- Distance exercises additionally get a `Set as time` toggle.
- Subtitle `Weight · 4 sets` / `Time · 3 sets` / `Distance · 2 sets`.
- A set table — columns `SET | PREV | TARGET` — where each row carries the set number, the
  previous session's performance (`80 kg × 8`), measure-specific inputs, an ✕ to drop the set,
  and a circular tick. Completed rows tint green; a timed set's row shows an orange
  `▶ Timer` button instead of a plain target.
- `+ Add set` (dashed).

**`+ Add exercise`** (dashed, orange) at the bottom of the list.

## Locked decisions for this phase

| Decision | Reasoning |
|---|---|
| **The rest timer uses `expo-notifications`** | Settled by the user on 2026-09-02 over the cheaper wall-clock-only option, so a locked phone buzzes when rest ends. See slice H4. |
| **Every mutation goes through the Phase F event log first** | `appendSessionEvent` is the write path; React state is a projection of it. This is what makes `replaySessionState` real rather than decorative — CLAUDE.md rule 6 and ADR-025. |
| **No network call anywhere in this screen** | Rule 6. Exercise names and measures come from `exercises_cache` (ADR-022); the session upload is Phase I's job, off the critical path. |
| **Heart rate ships as an honest empty state** | The prototype *simulates* HR with `Math.sin(elapsed/9)`. There is no `HealthProvider` reading live HR yet. Following the Phase J precedent — where invented numbers presented as the user's own data were explicitly rejected — the Watch card renders its layout with a "not connected" state rather than fake bpm. |
| **`PREV` reads from local history, and is blank when there is none** | Same principle. It is populated once sessions exist; a first-ever session shows an empty `PREV` column, not a fabricated one. |
| **Weights are entered in the display unit and stored in kg** | ADR-016. `convIn`/`convOut` in the prototype; the wire and the log are always kg. |
| **The set-timer and rest screens are routes, not modals** | Matches the prototype's own `screen:'setTimer'` / `screen:'rest'` transitions and keeps the Android back button meaningful. |

## Slices

Deliberately several small ones rather than one large phase, so each can be reviewed, tested
and merged on its own — and so the session can stop between any two.

**H1 — the session store seam.** `apps/mobile/src/workouts/live-session.ts`: the pure
reducer that turns a template + a list of `SessionEventRecord`s into the live screen's view
state, and the action helpers that produce events. No React, no SQLite, no I/O — so it is
fully unit-testable, and the screen becomes a thin renderer over it.
**Tests first**: complete a set → `set_completed` appended and rest started; complete the last
set of an exercise → `exercise_completed`; pause/resume bookkeeping; volume and set counters;
that replaying a partial log rebuilds identical state.

**H2 — the live screen.** `apps/mobile/src/app/live.tsx`, built against
`live workout.png`/`live workout 2.png`: header, progress, exercise cards, the set table for
all three measures, add/remove set, add/remove exercise, the unit pill, and the goal chip.
Reads exercise names/measures from `exercises_cache`.
**Tests**: with every `@/auth/apiClient` function mocked to reject, a session can still be
started, logged and finished — the explicit offline proof `phase-3-plan.md` asks for.

**H3 — rest and the timed set.** `rest.tsx` and `set-timer.tsx` from `s_rest()` and
`s_setTimer()`: the 200 px progress ring, `−15`/`+30` on rest and `±15` on the timed set,
"Up next", Skip Rest, and the auto-push into rest when a set is ticked.

~~**H4 — notifications.**~~ **Done.** `expo-notifications` (`~0.32.17`, pinned by
`npx expo install`) behind `workouts/rest-notifications.ts`, an injected-scheduler seam
mirroring ADR-022's. Permission is asked at the **first rest**, never at launch, and a refusal
leaves the on-screen countdown working. Schedule and cancel are symmetric across every exit —
expiry, Skip Rest, hardware back, and an adjustment that supersedes the schedule — including
the race where the screen unmounts before the schedule promise resolves.
[**ADR-026**](../decisions/ADR-026-rest-timer-notifications.md) records the decision. **The
device walk is still outstanding and is mandatory**: Jest covers the seam's logic but cannot
prove the OS schedules or delivers anything.

~~**H5 — entry points.**~~ **Done.** `Start now` (builder) and `Start workout` (workout detail)
both build a session and push `/live`. Session ids come from `expo-crypto`'s `randomUUID` and
double as the sync idempotency key. Starting from the builder deliberately does *not* save the
template first. This slice also fixed a dead end the phase had introduced: the live screen's
`Add exercise` pushed `/library?pick=live`, which the library explicitly ignored, so tapping a
row abandoned the workout in progress.

## Known gaps before this is production-ready

Recorded deliberately rather than discovered later. None of these block the slices above, but
all of them are real and two are user-visible.

1. ~~**Crash recovery is not wired up.**~~ **Fixed** — see `session_snapshot`, `restoreSession` and the live screen's resume path. The original problem, kept for context:
   `replaySessionState` existed and was tested, but **nothing called it**. The live screen
   started only from the in-memory handoff, so force-killing the app mid-session lost the
   session entirely and orphaned its events.

   **How it works now.** The event log records *what happened* but not *what the session is* —
   its name, exercises and prescribed targets are nowhere in it — so replay alone cannot rebuild
   a screen. A third table, `session_snapshot`, stores the started session once, at start; the
   live screen, finding no handoff, reads it back, replays the log over it with
   `restoreSession`, and comes up with the ticked sets, paused state and elapsed time intact.
   The snapshot is written **once** rather than per tick, because the mutable part of a session
   is exactly what the log already carries — rewriting it per change would reintroduce the
   mutable "current session" row the append-only design exists to avoid. It is dropped when the
   session finishes, and a session whose replay says `completed` is never resumed: it belongs to
   the sync queue, not to another workout.

   One subtlety worth keeping: **the stretch the app spent closed counts as paused, not as
   training.** The elapsed clock is wall-clock based, so without seeding the paused total on
   resume, an app killed for an hour would add that hour to the workout.
2. ~~**Finishing a workout does not enqueue it for upload.**~~ **Fixed in Phase I** — the live screen now builds a `WorkoutSessionUploadRequest` via `toUploadRequest` and calls `enqueueSessionUpload` on Finish. The original problem: `workout-session.ts`'s own module
   docblock says a session "enters this table exactly once, when a `workout_finished` event is
   appended", but `appendSessionEvent` does no such thing — it only inserts into
   `session_events`. Nothing writes to `session_queue`. That wiring is Phase I's job, but the
   docblock currently describes behaviour that does not exist and should be corrected either
   way.
3. **Elapsed time and paused time are React state**, so they reset if the screen remounts. They
   should be derived from the log on resume, alongside gap 1.
4. **Abandoned sessions leak.** Nothing prunes `session_events` for a session that is never
   finished, so the table grows without bound.
5. **The goal picker is not built.** The chip renders with its chevron, matching the design, but
   tapping it does nothing — the prototype opens a picker with an "apply to all" option.

## Explicitly out of scope

Named so a later session does not think they were forgotten:

- **The summary screen** (`workout done.png`) and the hand-off to the sync queue — that is
  Phase I.
- **The live *run* screen** (`live run 1.png`/`2.png`, `s_run()`) — a different modality with
  GPS and pace; it is not part of "live execution" for strength.
- **Real heart rate**, which needs a `HealthProvider` wired to the session.
- **The AI "How to train this" guide content** beyond the static goal table the prototype
  already hardcodes.

## Verification

Per slice and again before each merge — the phase-wide bar from `phase-3-plan.md`:

```bash
TZ=UTC pnpm --filter @forjd/mobile test --ci --watchAll=false
```

plus `pnpm typecheck`, `pnpm lint`, `pnpm conformance`, and a real bundle compile
(`npx expo export --platform android`). `TZ=UTC` is not optional.

**Two cautions learned this session:**

- **Await everything in RTL.** `@testing-library/react-native` v14 makes `render()` and every
  `fireEvent.*` return Promises. An un-awaited one silently empties the rendered tree for
  every later test in the file. New suites in this phase must await both.
- **Run the suite with the machine otherwise idle.** Under CPU contention the mobile suite
  fails a shifting set of suites purely on 30 s timeouts — 20 suites under load, 4 when
  quieter, 0 in isolation. A red run is not a regression until it reproduces on a quiet
  machine.

**Device walk** (handed over, not waited on): airplane mode on, start a session, log sets,
take a rest, lock the phone and confirm the notification fires, force-kill the app mid-session,
reopen and confirm the session resumes from the event log.
