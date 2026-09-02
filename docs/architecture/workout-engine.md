# Workout engine

## Extensible from day one

Not `exercise / sets / reps`. A `WorkoutBlock` carries a type even though
only strength training is implemented at first:

```
WorkoutDefinition
  type, modality, duration, difficulty, equipment,
  exercises, blocks, intervals, metadata
```

Block types: straight sets, superset, interval, AMRAP, time-based. This is
what lets HYROX, running, or Pilates get added later as *content* (new
blocks, new templates) rather than a schema migration or a second workout
engine — see the source planning docs' worked examples (weightlifting,
HYROX, running, Pilates, cross-training) for what the same block-type
vocabulary needs to express.

```
                    Workout Engine
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
   Strength       Interval      Time-based
      │              │              │
      └──────────────┼──────────────┘
                     ▼
                Workout Session
```

## Template/session split — critical

```
WorkoutTemplate    what the program tells the user to do
WorkoutSession      what the user actually did
```

Example: template says `Squat 4×8 @ 100kg`; the actual session might be
`100×8, 100×8, 100×7, 95×8`. Keeping these separate — never overwriting the
template with what happened — is what makes progression analytics accurate.
This split exists from Phase 3 (the walking skeleton), not added later.

## Offline-first execution — a design constraint, not hardening

The live workout must work with the gym's internet down entirely.

```
Workout downloaded → Local SQLite (expo-sqlite) → Workout execution →
Local session → Internet returns → Sync to backend
```

- Local write is the source of truth during a session; the network is
  never in the critical path (`CLAUDE.md` rule 6).
- All session events are persisted locally as an append-only log:
  `SetCompleted`, `RestStarted`, `RestCompleted`, `ExerciseCompleted`,
  `WorkoutPaused`, `WorkoutResumed`, `WorkoutFinished`. This is what makes
  crash recovery real — a force-killed app resumes mid-session instead of
  losing the workout.
- The sync queue drains on reconnect, with idempotency keys so a retry
  can never duplicate a session server-side.

This is built into Phase 3 from the start. Retrofitting offline-first after
repositories are already written assuming a live connection means rewriting
every one of them — it is deliberately front-loaded instead.

## Programs

```
Program
  Goal, Duration, Difficulty, Training frequency
  Week 1 → Day 1, Day 2, Day 3
  Week 2 → ...
  Progression rules
```

Enrollment snapshots the program version (`program_version`) at the moment
a user starts it. Updating a program's content later never silently
rewrites someone's in-flight 12-week cycle — new enrollments get the new
version, existing ones keep what they started with.

## Local mobile database

`expo-sqlite` holds: the exercise catalogue (`exercise-catalogue.ts`, ADR-022), and workout
sessions in progress plus their pending sync queue (`workout-session.ts`, ADR-025) — the
append-only event log that makes crash recovery real, and the queue that holds a finished
session until it uploads. This local layer, not the network, is what the live-workout UI
reads and writes to.

Superseded from an earlier draft of this doc: Drift, a Flutter-only SQLite wrapper, was
named here under ADR-001's original Flutter client. ADR-013 replaced Flutter with Expo/React
Native, and ADR-022 picked `expo-sqlite` as the concrete store — this doc just hadn't been
updated to say so until ADR-025.
