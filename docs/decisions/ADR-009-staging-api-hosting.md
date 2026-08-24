# ADR-009: Railway hosts the API

**Status:** Superseded by [ADR-015](ADR-015-supabase-topology-and-free-host.md)
**Date:** 2026-08

**Why superseded:** Railway's paid tier (the reason "no cold starts" below held) was
declined on cost after this ADR was written — FORJD runs on free tiers only. See ADR-015
for the replacement decision.

## Context

Phase 1's definition of done requires the auth and profile flow to work "against the
deployed staging API from the physical device." Nothing in the repo named a host, so
slice 13 had no starting point.

The thing being hosted is smaller than it first appears. Supabase owns Postgres and
object storage, so `apps/api` is a single stateless NestJS container. It needs a public
HTTPS URL an Android phone can reach, environment variables for the Supabase keys, and —
from Phase 5 — a Redis instance for BullMQ.

The real constraint is not technical. At 12 hrs/week, hours spent on deployment
mechanics are hours not spent on the product, and slice 13 sits directly between the
current state and the phase completing.

## Decision

Railway hosts the staging API, and production when it arrives.

Deployment is push-to-deploy from the GitHub repo against `apps/api/Dockerfile`.
Migrations run as a release step (`pnpm --filter @forjd/api db:migrate`) against the
Supabase Postgres. Secrets live in Railway's environment configuration, never in the
repository.

## Rationale

- Least setup for a Dockerized service with no co-located database. Slice 13 stays as
  small as it was scoped to be.
- Managed Redis is available in the same project with private networking, so Phase 5's
  BullMQ work adds a queue rather than a vendor.
- No cold starts on the paid tier. This is worth more than it sounds: every device
  verification from slice 14 onward means picking up a phone and exercising the app
  against staging, and a host that sleeps makes a routine check tedious enough to skip.
- Push-to-deploy matches the GitHub Actions pipeline already written in slice 7.

Render was rejected because its free tier spins down after inactivity, which lands
exactly on the device-testing workflow; its paid tier costs roughly the same as Railway
for less convenience. Fly.io was rejected as premature rather than wrong — it is
Docker-native and genuinely good, but its advantages are regional deploys, machine
sizing, and scaling control, none of which this service uses. Its `fly.toml` and
machines model is more to learn for no present benefit.

## Consequences

- Two hosting relationships now exist: Supabase for data and auth, Railway for compute.
  Both are reached through configuration, and `AuthProvider`/`StorageProvider` (ADR-008)
  already keep Supabase out of business logic. Railway holds no such position — it runs
  a container and injects environment variables, so replacing it is a redeploy.
- Usage-based pricing is cheap at this scale but can overtake flat-rate hosts under
  steady load. Revisit after Phase 10, when subscriptions make real traffic likely.
  This ADR is not a permanent commitment; the Dockerfile is the portable artifact.
- Staging and production are separate Railway environments pointed at separate Supabase
  projects, so a staging deploy cannot reach production data.
- Pricing and free-tier terms were not verified against Railway's current published
  rates when this was written. Confirm before the first paid month.
