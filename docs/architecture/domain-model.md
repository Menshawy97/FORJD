# Domain model overview

This file is the map; each linked doc has the detail. Read the linked doc
before touching that domain's schema or adapters.

## Core entities by domain

**Auth & users** — `users` (own UUID PK, `supabase_user_id` as one mapped
external identifier per ADR-008), `profiles`, `goals`,
`preferences`. See `system.md` ("Portability").

**Exercise content** — `exercises`, `exercise_variants`, `muscle_groups`,
`equipment`, `exercise_muscles`. Ingested via `ExerciseSourceAdapter` with
version-controlled override files layered on top. See `integrations.md`,
ADR-005.

**Programs & workouts** — `programs` → `program_weeks` → `program_days` →
`workout_templates` → `workout_blocks` → `workout_exercises`, separately
from `workout_sessions` → `workout_session_exercises` → `workout_sets`. See
`workout-engine.md`.

**Health** — `health_connections`, `health_permissions`,
`health_observations` (the canonical `HealthObservation` shape),
`health_workouts`, `sleep_sessions`. See `health-data.md`, ADR-004.

**Body composition** — `body_scans`, `body_scan_files`,
`body_scan_extractions`, `body_composition_measurements`. See
`health-data.md`, ADR-006.

**Analytics** — `daily_metrics`, `weekly_metrics`, `progress_metrics`,
`insights`. See `analytics.md`.

**Integrations** — `external_connections`, `sync_cursors`, `sync_jobs`. See
`integrations.md`.

**Platform** — `feature_flags`, `audit_logs`, `notifications`.

## Design principles applied throughout

- **Extensible observation over rigid columns** where external data shapes
  are still growing (`health_observations`, `body_composition_measurements`)
  — first-class columns for what's known, JSONB metadata for what isn't yet.
- **Template/execution separation** wherever "planned" and "actual" diverge
  (`workout_templates` vs `workout_sessions`, `programs` vs enrollment
  snapshots at a fixed `program_version`).
- **Source preserved, never overwritten**, wherever multiple external
  systems can report the same fact (`health_observations.source`).

## What's deliberately not modeled yet

Nutrition, social/friends, achievements/gamification, and an admin CMS are
named in the source planning docs as future domains but have no schema yet
— see `docs/product/roadmap.md` for when each is planned. Don't add
placeholder tables for them; add the schema when the phase that needs it
starts, informed by what's been learned by then.
