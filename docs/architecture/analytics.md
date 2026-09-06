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

**Documented exception: the Progress tab's Strength view (Phase 4).** Its
figures — recent PRs, an 8-week estimated-1RM trend, weekly volume, a
training calendar, a muscle-group split — are computed on read, with no
rollup table and no scheduler, because none exists in the stack yet and
the read is a small, indexed, per-athlete scan.
[ADR-029](../decisions/ADR-029-progress-analytics-computed-on-read.md)
records the reasoning and the trigger for revisiting it once Phase 6's
per-minute health-observation volume actually strains this approach.

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

## FORJD Insight is rules-based, not AI

The Home and Progress "insight" cards are titled **FORJD Insight**, not
"AI insight" — the design's own label. Their sentence is the output of
`evaluateInsight` in `@forjd/domain`, assembled from the athlete's own
numbers against published training-science thresholds, never a model
call. See [ADR-030](../decisions/ADR-030-forjd-insight-rules-based-not-ai.md)
for the full evidence base and, just as importantly, the specific claims
(a prescribed deload, an injury-risk framing) the card is barred from
making because the evidence for them is contested.

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

[ADR-031](../decisions/ADR-031-readiness-score-methodology.md) records the
evidence-backed methodology for the readiness score specifically —
WHOOP's four sleep-window inputs measured against the athlete's own
baseline, decomposed exactly as this rule requires, rather than WHOOP's
own undisclosed-weighting composite, which independent research found did
not reliably track perceived recovery even though its own HRV input did.

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
