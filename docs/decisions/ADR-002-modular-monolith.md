# ADR-002: Modular monolith backend, not microservices

**Status:** Accepted
**Date:** 2026-08

## Context

The backend has clearly separable domains — auth, training, health integrations,
body composition, analytics, insights — which could be built as independent
services. At solo/12-hrs-a-week scale, running 5-15 services means paying
operational complexity (deployment, service discovery, distributed tracing,
inter-service auth) for a problem (independent scaling, independent deploys)
that doesn't exist yet.

## Decision

Build a single NestJS application (`apps/api`) as a modular monolith: domains
are separated by NestJS module boundaries and folder structure, not network
calls. See `docs/architecture/system.md` for the module layout.

## Rationale

- NestJS modules give real logical separation (each domain owns its own
  controllers, services, and repository access) without the operational tax
  of running separate deployables.
- A modular monolith with clean module boundaries can be split into real
  services later, module by module, if scale ever justifies it — the
  boundaries already exist, the split is mechanical rather than a rewrite.
- One deployable is one thing to monitor, log, and debug — appropriate for a
  team of one.

## Consequences

- Module boundaries must be enforced by discipline and (from Phase 1) CI
  checks, not by the network — see `CLAUDE.md` rules 1-4. A monolith with
  tangled module boundaries is worse than either a clean monolith or clean
  microservices.
- All domains currently share one Postgres database and one deploy cadence.
  Revisit only when a specific domain's scaling or team-ownership need
  actually appears — not speculatively.
