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

**This rule currently has no referent, and that's expected, not a defect.**
The Progress tab's Strength view — today's one real construction of the
"Aggregated" layer — computes on read rather than persisting a rollup
([ADR-029](../decisions/ADR-029-progress-analytics-computed-on-read.md)).
There is no stored aggregate anywhere in the system today, so there is
nothing for rule 9 to protect: every response is recomputed from raw data
on every request, which is the strictest possible way to honor the rule
rather than a way of dodging it. Rule 9 stays in `CLAUDE.md` for if and when
this pipeline moves to persisted staged aggregates (see ADR-029's "Revisit
trigger" — likely alongside Phase 6's health-observation volume and the
BullMQ/Redis infrastructure Phase 5 is expected to bring in). Until then,
don't read the rule's silence as unenforced; read it as unneeded.

## City leaderboards are derived too (Phase 10)

Leaderboard standings follow the same rule as every other aggregate: computed from the
raw sessions, never stored and patched. The board is computed on read, with eligibility
joined live so a withdrawal is immediate, and the only stored copy is the weekly rank
snapshot, which is replaced wholesale in a transaction, never updated. The Activity score is a
plain calculation against published WHO targets, a participation metric rather than a
fitness assessment, and is never described as AI or an insight. See ADR-046 and ADR-047.

## Weekly Forge stores its weekly results (ADR-057)

Weekly Forge's levels depend on history, since a level is where last week's result left it, so
they can't be computed on read. They are the one deliberately stored evaluation in the analytics
model, and they're kept inside rule 9 as follows:

- **Locked inputs, stored once.** When a week closes (midnight Friday in the athlete's own zone,
  Saturday to Friday weeks per ADR-056), the evaluation job counts that week's raw rows, meaning
  rows created by the close and not deleted before it. It stores the total, the target and the
  result in `forge_weeks`. A closed week is never edited: later edits to raw data don't change it.
- **State is a fold of those rows.** `forge_user_ladders` (current level, streaks) is what
  replaying the stored weeks through the pure rules in `@forjd/domain` produces, so it can always
  be rebuilt from the locked history. That rebuild tool is deferred until the rules first change.
- **An append-only ledger.** `forge_rewards` gains a row the first time a level or band is reached,
  and every time an athlete enters Forged. Unique keys make a re-run a no-op; nothing updates or
  deletes a ledger row.
- **Two triggers, one path.** An hourly GitHub Actions job on Fridays and Saturdays (UTC)
  evaluates closed weeks, and reading `GET /forge` evaluates the caller's own closed weeks first.
  Both take the same row lock, so a week is written once however the two race.

Everything else about a week is computed on read: this week's live totals, and the celebration
and summary derived from the stored results (`@forjd/domain`'s `summariseWeek`). Nourish is
counted as days with meals logged, is never public, and never gets a share card. See
[ADR-057](../decisions/ADR-057-weekly-forge.md) and `docs/product/weekly-forge-plan.md`.

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

## Event system (designed, not built)

> **Status (2026-09-26):** none of this exists. `apps/api/src` has no event bus, no
> `@OnEvent` subscriber and none of the event names below. Derived analytics are
> **computed on read** instead (ADR-029): progress, streaks, PRs and leaderboards are
> calculated when asked for, from the stored sessions and observations. The design below is
> kept as the intended shape if write-time derivation is ever needed (for example once
> read-time computation stops being fast enough), not as a description of the running system.

Domain events would drive derived-data updates, replacing a pattern where one
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
