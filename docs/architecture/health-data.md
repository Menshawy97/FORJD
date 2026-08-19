# Health data model

## Canonical HealthObservation

See ADR-004 for the full rationale. Shape:

```
HealthObservation
  id, user_id, metric_type, value, unit,
  start_time, end_time, source, provider_record_id,
  device_id, quality, created_at
```

`metric_type` is a fixed, provider-agnostic vocabulary: `heart_rate`, `hrv`,
`resting_heart_rate`, `sleep_duration`, `steps`, `active_energy`, `weight`,
`vo2_max`, `respiratory_rate`, and so on. Analytics and dashboards query
this vocabulary, never a provider's native field names.

## Source is preserved, never overwritten

Duplicate observations from multiple providers are stored as separate rows:

```
metricType: hrv, value: 62, source: whoop
metricType: hrv, value: 60, source: apple_health
```

Reconciliation happens at *read time* via a per-metric source-priority
policy, e.g.:

```
HRV:    1. WHOOP           2. Apple Health / Health Connect
Weight: 1. InBody           2. Apple Health / Health Connect
Steps:  1. Health Connect   2. Apple Health
```

The policy is data (eventually user-customizable), not hardcoded branching.
Build this reconciliation layer when the *first* provider ships (Phase 6),
even though there's nothing to reconcile yet — retrofitting it once WHOOP
(Phase 7) arrives means backfilling, which is the expensive path.

## Ingestion pipeline

```
Provider → Raw ingestion → Provider normalization (the HealthProvider
adapter's job) → Deduplication → Canonical HealthObservation →
Aggregation (analytics.md) → Analytics
```

Sync is checkpointed (`last_successful_sync_at`) and incremental, using
provider record IDs for dedup where the provider supplies them. The mobile
UI requests a sync and gets notified when it completes; it never blocks on
"sync everything" at app open.

## Body composition

`BodyCompositionMeasurement` follows the same extensible-observation shape
as `HealthObservation`, because new InBody-reported fields (bone mass,
protein mass, phase angle, ...) should not require a schema migration:

```
BodyCompositionMeasurement
  id, user_id, measured_at, source, measurement_type, value, unit, confidence
```

## InBody photo pipeline

First-class domain (`BodyScan`), not a generic file upload. See ADR-006 for
the extraction-approach decision.

```
Photo upload → image quality check → Claude vision extraction
(structured JSON + per-field confidence) → confidence scoring
→ mandatory confirmation screen → user-confirmed BodyScan record
```

Non-negotiable, regardless of how good extraction accuracy measures out in
Spike B: nothing saves unconfirmed. High-confidence fields pre-fill but
still require an explicit tap to confirm; low-confidence fields render
blank, forcing the user to type the value. This is the mechanism that keeps
"AI is a validator, never the sole source of truth" true even though the
extraction method itself (Claude vision) was chosen specifically because it
skips building a deterministic layout parser.

Golden-fixture tests (`tests/fixtures/inbody/`: anonymized report images +
expected extraction JSON) run in CI from Phase 5 onward, and are the
tripwire for silent extraction-quality drift over time — see `CLAUDE.md`
rule 8.

## Data minimization for AI calls

Health data reaching the AI context-builder is a structured summary, never
raw records:

```json
{
  "goal": "fat_loss",
  "training": { "frequency": 4, "volume_trend": 0.12 },
  "sleep": { "average_hours": 6.9, "trend": -0.4 },
  "recovery": { "trend": -0.08 },
  "body_composition": { "weight_change_30d": -1.8, "body_fat_change_30d": -1.2 }
}
```

This matters more once real strangers' data is involved (from the beta
onward) than it did for any earlier personal-tool version of this idea.
