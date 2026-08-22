# State and data

The prototype keeps one flat state object — 66 keys — because it has no router, no database
and no network. This document says what each key **is**, so you can put it where it belongs
in Flutter instead of transcribing the shape.

Three destinations:

- **Route state** — belongs to `go_router` (a path, a parameter, or stack depth). Do not
  build a state field for it.
- **Controller state** — a Riverpod `Notifier` in `features/<x>/application`.
- **Repository / Drift** — persisted. Survives a kill.

Anything marked **fixture** is placeholder content written by hand to make the screen
photograph well. It is not a data contract. Every fixture is either replaced by a real source
in the phase named in the README, or by `free-exercise-db` (ADR-005).

---

## Route state — do not port

| Key | Why it exists |
|---|---|
| `screen` | the only reason the prototype can navigate at all |
| `progTab` | which Progress tab — `Strength`, `Body` or `Health`; becomes a tab index or `/progress/:tab` |
| `goalsReturnTo` `proReturnTo` `inbodyReturnTo` `exerciseReturnTo` `programReturnTo` `programBuilderReturnTo` `builderReturnTo` `locationReturnTo` | eight hand-maintained back targets. `go_router` gives you all eight for free with `pop()`. Two of them were wrong before the audit — see `06-audit-log.md` |
| `viewAthlete` | the athlete being viewed — `{name, n, score, priv, self}`. In Flutter `/athlete/:id`; `priv` is a server decision, not a client flag |
| `selectedProgram` `selectedWorkout` `selectedScan` `selectedHistory` `ex` | "which record am I looking at" — becomes a path parameter (`/program/:id`), not state |
| `libraryPickMode` | a real *mode*, so keep it — but as a route parameter (`/library?pick=workout|routine`), not a boolean field |

## Controller state — ephemeral UI

| Key | Type | Notes |
|---|---|---|
| `rankTab` `rankPeriod` | `String` | leaderboard metric and period filters |
| `catFilter` | `String` | program catalogue chip filter |
| `libFilter` `libQuery` | `String` | library chip filter and search text. **Default is `All`** (the audit changed it from `Running`) |
| `stepRange` | `Day|Week|Month` | step-count card range |
| `guideOpen` | `bool` | the live screen's "How to train this" disclosure |
| `showAllWorkouts` `showAllPrograms` | `bool` | Train caps each list at **3** rows and reveals the rest behind *See all N* / *Show less*. In Flutter a local `StatefulWidget` flag — or a real "all workouts" route once the list outgrows a screenful |
| `metricTip` | `String?` | which home metric tooltip is open |
| `compareMode` `compareSel` | `bool`, `List<int>` | InBody compare mode; `compareSel` holds **at most two** |
| `signupErr` `signupErrMsg` | `bool`, `String` | sign-up validation. Clear on edit and on form open |
| `su` | `{name,email,pw}` | sign-up form buffer — a `TextEditingController` trio |
| `saveModal` `saveName` | `bool`, `String` | the name-your-workout modal on `done` |
| `connBusy` | `String?` | which provider row is mid-connect |
| `toast` | `String?` | see `05-interactions.md` |
| `shareKind` `shareLayout` | `String` | which session is being shared and which layout is picked |
| `proPlan` | `yearly|monthly` | selected plan on `pro` |
| `rpe` | `String?` | the RPE chip on `done` |
| `newProgram` | `{name,weeks,assign}` | program-builder buffer. `assign` maps a weekday to a workout name or `REST` |
| `routine` | `{name,base,type,ex[],days[]}` | workout-builder buffer |
| `deletedHistory` | `List<int>` | prototype-only. In Flutter, delete the row |

## Session state — a live workout or run

This is the part that must survive a crash, a phone call and airplane mode
(**CLAUDE.md rule 6**). In the prototype it is plain fields ticked by one `setInterval`; in
Flutter it is a Drift-backed session with a repository, and the timer is derived from a start
timestamp — never a counter incremented per tick, which drifts and dies with the isolate.

| Key | Meaning |
|---|---|
| `workout` | `[{name, note, sets:[{kg, reps, done}]}]` — the whole session. The only structure in the prototype that behaves like a real aggregate |
| `elapsed` | seconds since start. **Derive from a start time instead** |
| `paused` | pauses the ticker |
| `rest` `restTotal` | rest remaining and its total; default **90** |
| `hrNow` `hrSum` `hrN` | live heart rate and a running mean. Replace with a stream from `HealthProvider` |
| `run` | `{t, dist, pace, speed, hr}` — the live run's counters |

The ticker runs once a second and only advances when `screen` is `live`, `rest` or `run`,
which is what makes the prototype's numbers look alive. **Rest counts down and pushes back to
`live` at zero.**

## Repository / Drift — persisted

| Key | Becomes |
|---|---|
| `profile` | `{name, handle, city, birthday, sex}` — the user record. `handle` has **no column and no uniqueness policy yet** (README open question 4) |
| `isPro` | entitlement. Comes from RevenueCat in Phase 10, never from local state |
| `units` | `{system, weight, distance, energy}`. `unitSystem` already exists in the API |
| `goals` `acts` | onboarding selections |
| `conn` | provider → connected, for **three** providers (Apple Health, WHOOP, Health Connect). **Render from the `HealthProvider` registry** (rule 3), not this map. InBody is not a connected source — scans come in through the import flow |
| `notif` | five booleans; `rank` defaults **off** |
| `priv` | five booleans — `leaderboard`, `location`, `ai`, `publicProfile`, `diagnostics`; `publicProfile` defaults **off**. Consent flags: each gates a behaviour server-side, so store them with the user record and read them where the behaviour happens, not only on the settings screen |
| `myWorkouts` | the user's saved workouts and programs. `{name, type, meta, last, fav, ex?}` where `type` is `Preset | Custom | Program | Customised preset` and `meta` is a **pre-rendered display string** — in Flutter, store the counts and format at render |
| `activeProgram` | the followed program's name; `null` when not following. Should be an id |
| `scanDate` `scanTime` `scanVals` `seg` | one InBody scan being confirmed: nine metrics plus five segmental values, all **strings** because every one is user-editable. Parse and validate on save; store numbers |

## Fixtures — replaced, not ported

| Fixture | Replaced by |
|---|---|
| exercise library (~15 rows) | `free-exercise-db`, ~870 exercises + FTS5 (Phase 2, ADR-005). Rows now carry a fifth column — the **training goal** (`Strength`, `Hypertrophy`, `Power`, `Muscular endurance`, `Mobility`) — which the live guide reads. That field is a real import requirement, not a fixture: `free-exercise-db` has no goal, so map or author it |
| athlete PRs and recent sessions | the same aggregates behind `progress` and `workoutHistory`, filtered to what is public |
| program catalogue (9 programs) | authored program content (Phase 4) |
| every chart series | real aggregates (Phase 6) |
| readiness 87, HRV 68, sleep 7h 42m, RHR 52, steps 4.2k | `HealthProvider` (Phase 6) |
| leaderboard rows and scores | the ranking service (Phase 10) |
| `147` workouts, `#47` city rank, `9` this month | the same tile trio the roadmap already omitted from `profile` for want of a source |
| scan history dates and values | real scans (Phase 5) |
| AI insight paragraphs | generated copy. **Three insight cards are hand-written** — treat them as tone-of-voice examples, not strings to ship |

## Derived values worth keeping

These are computed in the prototype and are genuinely part of the design, not fixtures:

- **sets done / total** and **session volume** — `sum(kg × reps)` over ticked sets only
- **average HR** — `hrSum / hrN`, shown beside the live value
- **next incomplete set** — drives the rest screen's "Up next"
- **est. 1RM** — displayed but never computed in the prototype. Pick a formula (Epley,
  Brzycki) and record it in an ADR; the number appears on `exercise` and `progress`
- **week progress rail** — sessions this week over the program's target
