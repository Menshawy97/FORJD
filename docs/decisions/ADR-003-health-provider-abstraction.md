# ADR-003: HealthProvider adapter interface for all external health/fitness sources

**Status:** Accepted
**Date:** 2026-08

## Context

FORJD will eventually integrate Apple Health, Health Connect, WHOOP, and
potentially Garmin, Oura, and Fitbit. Each has a different API shape, auth
model, and data taxonomy. If application code (the workout engine, analytics,
dashboards) calls any of these directly, every new provider requires touching
every consumer, and the app's internal model becomes hostage to whichever
provider was integrated first.

## Decision

Every external health/fitness source is reached through a `HealthProvider`
interface:

```typescript
interface HealthProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): Promise<ProviderCapabilities>;
  requestPermissions(permissions: HealthPermission[]): Promise<PermissionResult>;
  sync(request: SyncRequest): Promise<SyncResult>;
}
```

Application code (workout engine, analytics, dashboards) never imports a
provider SDK or calls a provider's API directly — see `CLAUDE.md` rule 3.
Full detail in `docs/architecture/integrations.md`.

## Rationale

- Adding Garmin later means writing `GarminProvider` and nothing else changes
  — not a template claim, a structural guarantee enforced by the interface
  and the CI import check (`CLAUDE.md`, "Enforced, not just stated").
- The same adapter shape is deliberately reused for `ExerciseSourceAdapter`
  (Phase 2) and `AuthProvider`/`StorageProvider` (ADR pending, Phase 1) —
  one pattern, applied everywhere an external system meets the domain model.
- Contract tests (fixture provider response → adapter → canonical model) are
  what make this real rather than aspirational — see `CLAUDE.md` rule 8.

## Consequences

- Every provider integration front-loads adapter design work before any
  provider-specific feature ships. This is deliberate: the first provider
  (Health Connect, Phase 6) costs slightly more than a direct integration
  would; every provider after it costs much less.
- The interface must be shaped by the *union* of what providers can do, not
  the first provider integrated — `getCapabilities()` exists specifically so
  a provider that can't supply a given metric degrades gracefully instead of
  forcing every provider to support everything.
