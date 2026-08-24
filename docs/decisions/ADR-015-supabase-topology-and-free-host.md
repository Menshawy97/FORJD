# ADR-015: Supabase topology and free API host

**Status:** Accepted
**Date:** 2026-08-24
**Supersedes:** [ADR-009](ADR-009-staging-api-hosting.md) (hosting only — Supabase itself was never decided by an ADR before this one)

## Context

Slice 12 (build flavors) and slice 13 (deploy staging) were both blocked on the same pair
of decisions, not on implementation:

1. **Slice 12's original plan assumed three Supabase projects** — dev, staging, prod. Only
   two are available in practice. `forjd-dev` already exists (email/password auth, `inbody`
   storage bucket, verified working end to end); `forjd-prod` does not exist yet.
2. **ADR-009 chose Railway partly *for* its paid tier's absence of cold starts.** Railway
   was subsequently declined on cost — FORJD runs on free tiers only (see the standing
   constraint recorded for this project) — so that reasoning no longer applies and the host
   needs re-picking, not redirecting to Railway's free tier.

Both decisions matter for the same reason: Phase 1's definition of done requires exercising
the auth and profile flow "against the deployed staging API from the physical device," and
slice 14's device walk is what actually closes Phase 1. Before that, a release build also
has to survive App Store and Play Store review — a reviewer (or a TestFlight/Internal
Testing tester) exercises real signup/login/auth flows against whatever backend the release
build points at, so that backend has to behave like production, not like a convenience-mode
dev environment.

## Decision

**Supabase — two projects, not three, with local dev absorbing the slot a third project
would have used:**

- `forjd-prod` (new): production. Confirmation-on, matching what real users experience.
- `forjd-dev` (existing, repurposed): **staging**, not dev. Its config is brought in line
  with `forjd-prod` — specifically, email confirmation gets turned **on** (it is currently
  off, which is what lets the automated test suite's register → login round-trip without a
  mail step). This is the environment release builds, TestFlight, and Internal Testing
  point at.
- **Local development moves to the Supabase CLI's Docker stack** instead of a cloud
  project. This is what frees the third slot: `forjd-dev` no longer needs to serve double
  duty as both "where I test while coding" and "where staging lives," because day-to-day
  dev now runs against a local Postgres/Auth/Storage stack with no network dependency.

**Hosting — Google Cloud Run**, for `apps/api` (staging first, production once it exists).

Render and Koyeb were the cheaper-to-set-up alternatives (no card required historically),
but both sleep the free tier after ~15 minutes of idle, and neither was picked. Cloud Run's
free tier has a materially shorter cold start (~1-2 s, against a sleeping instance's much
longer wake time on the other two) and a real scale-up path on the same platform if traffic
ever justifies it — no migration off a hobbyist free tier is needed later, only a billing
tier change. The one cost is a card on file even at $0 usage, which is friction, not a
blocker.

## Rationale

**Why the local-Docker/prod/staging split over collapsing dev+staging onto `forjd-dev`.**
The alternative — keep using `forjd-dev` for both dev and staging as-is — is simpler to set
up today, but it means the confirmation-required flow that real users depend on in
production is never exercised before release: not in local dev, not in staging, not in CI.
The first real test of that flow would be during store review or with actual production
users, which is the wrong place to discover an auth bug in a health-data app. Moving local
dev to Docker instead removes that gap for a fixed one-time setup cost (Docker running
locally) rather than an ongoing one.

**Why Cloud Run over Render/Koyeb.** The three free hosts are close enough on setup cost
that the deciding factor is what a real user or a store reviewer experiences hitting a cold
instance. A slow or timed-out first request during store review risks a rejected or
flagged submission; the same thing happening to an early real user risks losing them before
the app has done anything. Render and Koyeb's free-tier sleep behavior makes that the
common case, not an edge case, for a low-traffic staging/early-production service. Cloud
Run's shorter cold start and its native room to grow made it the better fit for something
that is meant to go from staging to production without another hosting migration in
between.

## Consequences

- `apps/api/Dockerfile` needs writing (multi-stage, production dependencies only) — it did
  not exist under ADR-009 either, so this is new work regardless of which host was chosen.
- `forjd-dev`'s Supabase config changes: email confirmation goes from off to on. Any test or
  script that relied on the confirmation-off convenience (the register → login round-trip
  noted in `docs/product/roadmap.md`) needs to account for that once `forjd-dev` starts
  serving as staging rather than dev.
- Local development requires the Supabase CLI and Docker running locally. This is a new
  environment dependency that did not exist while `forjd-dev` served as the dev project.
- `forjd-prod` is the one genuinely new Supabase project to create. Once it exists, slice 12
  (build flavors / EAS Build profiles) is unblocked.
- Cloud Run needs a Google Cloud project and a card on file (even for $0 usage under the
  free tier) — a manual account-setup step, same category as the Supabase project creation
  it's blocked alongside.
- Per ADR-012, the access-token lifetime (currently 3600 s) should be shortened to 900 s in
  `forjd-dev` and in every project created later, including `forjd-prod` — unrelated to this
  decision but due at the same time, since both are "create/configure a Supabase project"
  steps.
- Neither Cloud Run's nor Render/Koyeb's current free-tier terms were independently
  re-verified beyond public documentation at the time of this decision — confirm before
  relying on them for a real staging deploy, same caution ADR-009 recorded for Railway and
  never got to act on.
