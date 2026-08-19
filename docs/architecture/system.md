# System architecture

## The most important architectural decision

Do not make Apple Health the internal database. Do not make WHOOP the
internal database. Do not make the workout database dependent on
Apple/Google terminology.

```
Apple Health ───┐
Health Connect ─┤
WHOOP ──────────┤
Garmin ─────────┤   →   Provider Adapters   →   Canonical Data Model   →   Postgres
Manual Entry ───┤
InBody Photo ───┘
```

This is what gives the product future-proofing: adding a provider is an
adapter, not a rewrite of everything downstream. See ADR-003, ADR-004.

## The four things that must be exceptionally well designed

1. **Canonical health model** — `HealthObservation`, detailed in `health-data.md`.
2. **Provider/integration abstraction** — `HealthProvider` and siblings
   (`AuthProvider`, `StorageProvider`, `ExerciseSourceAdapter`), detailed in
   `integrations.md`.
3. **Workout engine** — template/session split, extensible block types,
   detailed in `workout-engine.md`.
4. **Longitudinal analytics model** — raw → normalized → aggregated →
   derived → insight, detailed in `analytics.md`.

Everything else — programs, leaderboards, nutrition, social, AI coach — is
built *on top of* these four and should not require changing them.

## Backend shape: modular monolith

```
                     API
                      │
        ┌─────────────┼─────────────┐
        │             │             │
      Auth         Training       Health
        │             │             │
        │       ┌─────┴─────┐       │
        │       │           │       │
        │    Programs    Sessions   │
        │       │           │       │
        └───────┼───────────┼───────┘
                │
                ▼
             Analytics
                │
                ▼
             Insights
```

One NestJS deployable (`apps/api`), domains separated by module boundary,
not network call. See ADR-002 for why, and `CLAUDE.md` rules 1-4 for how
the boundaries are enforced.

## Repository layout

```
forjd/
├── apps/
│   ├── api/          NestJS — common, auth, users, exercises, workouts,
│   │                  health, body-composition, integrations/, analytics
│   └── mobile/        Flutter — app/, core/, domain/, data/, integrations/, features/
├── packages/
│   ├── domain/         Canonical models, shared TS types (exercise overrides live here too)
│   └── contracts/       API DTOs shared between api and mobile
├── docs/
│   ├── product/
│   ├── architecture/    (this directory)
│   └── decisions/       ADRs
├── scripts/
└── tests/fixtures/       Golden fixtures (InBody, provider contract tests)
```

`apps/admin`, `services/document-processing` as a separate deployable, and
`infrastructure/terraform` are deliberately not present — see ADR decisions
in the roadmap plan file (D4) for why they're deferred, not forgotten.

## Portability: Supabase is infrastructure, not architecture

Supabase provides auth, Postgres, and storage. It is never called directly
from business logic — see `CLAUDE.md` rules 11-14. This costs a small
amount of structure now (an `AuthProvider` and `StorageProvider` interface,
built in Phase 1) and turns a future migration off Supabase from a rewrite
into a scripted adapter swap. RLS is defense-in-depth, not the only place
an authorization rule lives.

## API versioning

`/api/v1/` from day one. Breaking changes get `/api/v2/`, never a silent
change to a version already in a shipped mobile build.
