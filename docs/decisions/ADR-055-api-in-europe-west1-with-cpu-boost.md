# ADR-055: The API runs in europe-west1, with startup CPU boost and no minimum instances

**Status:** Accepted
**Date:** 2026-09-26
**Decided by:** the user, at the 2026-09-25 review triage ("Yes, move to Europe"; "Free speed-up only")

## Context

The 2026-09-25 whole-app review measured the two biggest causes of slowness on the server side:

- **Distance.** The API ran on Cloud Run in `us-central1` (Iowa) while both Supabase databases are in
  `eu-west-1` (Ireland). Every query crossed the Atlantic, and a screen that needs a few queries paid
  that round trip several times.
- **Cold start.** Cloud Run scales to zero, and the first request after idle took **14.6 s**.

## Decision

1. **Cloud Run runs in `europe-west1` (Belgium).** It is the nearest Tier 1 (lowest price, same free
   tier) region to `eu-west-1`. The deploy reads it from `RUN_REGION` in `deploy-api.yml`, which is
   `vars.GCP_RUN_REGION` when set and `europe-west1` otherwise.
2. **Images stay in the `us-central1` Artifact Registry repository** (`GCP_REGION` still names it).
   Cloud Run pulls an image across regions, so no second registry is needed.
3. **`--cpu-boost`** is on. It gives an instance extra CPU while it starts, which shortens the cold
   start. The boosted CPU is billed only for the seconds of startup, a few vCPU-seconds per cold start,
   inside the free tier's monthly allowance.
4. **No `--min-instances`.** An always-warm instance removes cold starts but is billed around the
   clock, which breaks the free-tier rule. Revisit if FORJD moves off free tiers.
5. **Staging moves first.** Its new URL is `https://forjd-api-staging-772363715082.europe-west1.run.app`
   (Cloud Run's `service-projectnumber.region.run.app` shape). The mobile staging build
   (`apps/mobile/eas.json`) and the website's fallback URL change only after that service answers.
   Production moves by a manual `workflow_dispatch` deploy afterwards.

## Consequences

- A new region creates a new Cloud Run service with a new URL; the old `us-central1` services keep
  running until they are deleted by hand, and anything pointing at the old URL keeps working until
  then.
- The owner must update the website's `PUBLIC_API_URL` in Cloudflare Pages to the new production URL
  before the old production service is deleted.
- Cold starts still happen (no minimum instances), just shorter.
