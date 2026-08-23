# Domain model overview

This file is the map; each linked doc has the detail. Read the linked doc
before touching that domain's schema or adapters.

## Core entities by domain

**Auth & users** — `users` (own UUID PK, `supabase_user_id` as one mapped
external identifier per ADR-008), `profiles`, `privacy_settings`, `goals`,
`preferences`. See `system.md` ("Portability").

`profiles` (slice 2 additions): three independent unit preferences —
`weight_unit`, `distance_unit`, `energy_unit` — plus `training_goals` and
`activities` as `text[]`, and a volunteered `city` with a server-derived
`city_slug`. All `text`/`text[]`, never Postgres enums: narrowing an enum is
impossible (`ALTER TYPE` cannot remove a value), while narrowing the known-value
set in `@forjd/domain` costs nothing, which is what let the earlier `sex`
narrowing happen without a migration. `unit_system` survives alongside the three
real units as a `@deprecated` preset — see ADR-016.

`privacy_settings` is a table of its own, not columns on `profiles`, because it
answers a different question: `profiles` is what the app displays,
`privacy_settings` is what the server is *permitted to do*. Every flag is
boolean, `NOT NULL`, defaulting **false** — opt-in is the product decision this
table exists to encode, and a nullable flag would introduce a third state that
is neither consent nor refusal. `location_for_leaderboard` is only meaningful
while `leaderboard_opt_in` is true; that dependency is enforced in
`PrivacyService`, not as a `CHECK` constraint — see `security.md`. A row is
created transactionally alongside every new `users`/`profiles` row
(`UsersRepository.upsertFromIdentity`), and `PrivacyRepository.findOrCreate` is
defensive on top of that, so a row lost to any failure can never 500 the
settings screen rather than simply reading as all-off.

`training_goals` is deliberately not modeled in the existing `goals` table:
`goals` holds *measurable targets* (`target_value`, `target_date`, `status`),
while a training goal like "Get stronger" is an untargeted intent with neither.
Reusing `goals` would force those columns to hold something meaningless.

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
