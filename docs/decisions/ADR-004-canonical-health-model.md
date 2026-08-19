# ADR-004: Canonical HealthObservation model

**Status:** Accepted
**Date:** 2026-08

## Context

Health/fitness metrics (heart rate, HRV, sleep, steps, weight, VO2 max, ...)
arrive from multiple providers with different field names, units, and
granularity. Storing each provider's native shape means every analytics
query and every UI screen needs to know about every provider's schema — the
same problem ADR-003 solves for the connection layer, one level down in the
data itself.

## Decision

All health/fitness metrics, regardless of source, are stored as
`HealthObservation` records:

```
id, user_id, metric_type, value, unit, start_time, end_time,
source, provider_record_id, device_id, quality, created_at
```

`metric_type` is a fixed vocabulary (`heart_rate`, `hrv`,
`resting_heart_rate`, `sleep_duration`, `steps`, `active_energy`, `weight`,
`vo2_max`, `respiratory_rate`, ...), not a provider-specific field name.
Full detail in `docs/architecture/health-data.md`.

## Rationale

- Analytics and dashboards query one shape (`WHERE metric_type = 'hrv'`)
  regardless of how many providers are connected.
- `source` is preserved, never overwritten — duplicate observations from
  multiple providers (e.g. HRV from both WHOOP and Apple Health) are stored
  as separate rows, reconciled at read time by a per-metric source-priority
  policy (`CLAUDE.md` rule 10), not collapsed at write time. This is what
  makes the source-priority policy possible at all — if only one value per
  metric were kept, there would be nothing left to prioritize between.
- `metadata`-style extensibility (a JSONB column for provider-specific
  fields not yet in the fixed vocabulary) means new metric types don't
  require a schema migration for every provider quirk — see
  `docs/architecture/health-data.md` for the boundary between what's a
  first-class column and what's JSONB.

## Consequences

- The normalization layer inside each `HealthProvider` adapter is where the
  real work of an integration lives — mapping a provider's native fields to
  `metric_type` + `unit` + `value` correctly, including unit conversion.
  Under-investing here corrupts data silently; contract tests exist
  specifically to catch this (`CLAUDE.md` rule 8).
- Body composition measurements (weight, body fat %, muscle mass, ...) follow
  the same extensible-observation pattern via `BodyCompositionMeasurement`,
  documented separately in `docs/architecture/health-data.md` because their
  primary source (InBody photo extraction) has a distinct confidence/
  confirmation pipeline — see ADR-006.
