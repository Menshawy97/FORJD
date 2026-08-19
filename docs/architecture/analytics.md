# Analytics

## Layered, not ad hoc

```
Raw           Exactly what providers provide
Normalized    Canonical health and workout data (HealthObservation, WorkoutSession)
Aggregated    Daily / weekly rollups
Derived       recovery_score, training_load, fitness_trend, body_recomposition
Insight       Human-readable conclusions
```

Aggregation jobs are scheduled, not computed on read — `daily_sleep`,
`daily_steps`, `daily_hrv`, `daily_training_load`, `weekly_training_volume`,
`weekly_recovery_average`, and similar rollups are written by a job and
read by dashboards, never recomputed per-request from raw observations.

## Never mutate an aggregate directly (CLAUDE.md rule 9)

Aggregates are derived, not edited. If a correction is needed (a backfilled
observation, a fixed source-priority policy), the aggregation job re-runs
over the affected window — the aggregate is never hand-patched. This is
what keeps aggregates trustworthy as a rebuild target.

## Progress engine

Input: workout history, health data, body composition, goals. Output:
`ProgressMetrics` — weight trend, fat trend, muscle trend, strength trend,
training volume, running pace, VO2 max trend, resting HR trend, HRV trend,
sleep trend, consistency.

## No single opaque health score

Don't build `Health = 83` with no explanation. Instead, component scores
that are individually meaningful:

```
Recovery       81
Strength       76
Cardio         68
Sleep          72
Consistency    92
Body Comp      85
```

An overall trend can be derived from these, but the components are always
visible. If a scoring model is introduced, version it
(`score_model_version`) so historical scores remain interpretable after the
model changes.

## Event system

Domain events drive derived-data updates, replacing a pattern where one
controller fans out to fifty services:

```
WorkoutCompleted
   ├── Update training volume
   ├── Calculate PR
   ├── Update consistency
   ├── Update training load
   └── Recalculate insights
```

Other events: `UserCreated`, `HealthProviderConnected`, `HealthDataImported`,
`WorkoutStarted`, `BodyScanUploaded`, `BodyScanProcessed`,
`BodyScanConfirmed`, `ProgramStarted`, `GoalChanged`.

## AI insight generation

The AI never receives raw records — see `docs/architecture/health-data.md`
("Data minimization for AI calls") for the context-builder pattern. Roadmap
for AI capability, from `docs/product/roadmap.md` Phase 10+: read-only
explanations first ("why did my weight change"), then recommendations
("should I increase weight"), then adaptive programming, only much later a
full personal-coach model. Each stage ships only once the previous stage's
output has been validated against real usage — this roadmap is aspirational
sequencing, not a commitment to build all of it in the phases already
planned in `docs/product/roadmap.md`.
