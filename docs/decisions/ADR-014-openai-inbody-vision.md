# ADR-014: OpenAI vision replaces Claude vision for InBody extraction

**Status:** Accepted
**Date:** 2026-08
**Supersedes:** ADR-006 (vendor choice only)

## Context

ADR-006 proposed Claude vision as the primary InBody photo extractor, conditioned
on a mandatory confirmation gate and on Spike B measuring real per-field accuracy
before the ADR could move from Proposed to trusted. Spike B never ran under either
vendor — `ANTHROPIC_API_KEY` was unset and the spike was still pending when the
mobile framework pivot (ADR-013) prompted a broader look at AI vendor choice for
the app.

The user has decided to standardize on OpenAI for all AI-backed features in the
app — both the text-insight cards (Home "Insight", Progress "AI Insight") and
InBody photo extraction — rather than running two LLM vendors for two different
jobs.

## Decision

InBody photo extraction uses **OpenAI's vision-capable models** instead of Claude
vision. Everything else ADR-006 established stays unchanged:

- The pipeline shape: photo upload → image quality check → vision extraction
  (structured JSON with per-field confidence) → confidence scoring → mandatory
  confirmation screen → user-confirmed `BodyScan` record.
- The non-negotiable: nothing saves unconfirmed. High confidence pre-fills a
  field the user must still tap to confirm; low confidence leaves it blank.
- Spike B's methodology is unchanged and still has to run before this ADR can be
  trusted in production: 10-15 real InBody report photos across varied models/
  lighting/angle/glare/crops, scored on **per-field accuracy** against
  hand-labelled ground truth (not document-level accuracy), with an explicit
  check of whether confidence scores correlate with actual errors.

Only the vendor and model name change in `docs/architecture/health-data.md`'s
pipeline description and in the golden-fixture test harness
(`tests/fixtures/inbody/`).

## Rationale

Two vendors for two AI-backed feature areas is avoidable operational complexity
for a solo-maintained app — one API key to provision, rotate, and monitor cost
for, one provider-adapter implementation, one rate-limit/quota surface. Nothing
in ADR-006's reasoning was Claude-specific: the confirmation-gate requirement
exists because *any* vision model can misread a digit, not because of a
particular vendor's error profile. Standardizing doesn't weaken that requirement;
it just means the provider swap is a config/adapter change rather than a
different architecture.

## Consequences

- `docs/architecture/health-data.md`'s "AI is a validator, never sole source of
  truth" pipeline description needs its vendor reference updated.
- Spike B is unblocked by provisioning an OpenAI key instead of an Anthropic one
  (both were previously blocked on missing keys) — still has to actually run
  before this ADR is production-trusted, exactly as ADR-006 required.
- The InBody vision provider and the insight-generation provider (Home/Progress
  AI cards, new in this phase) can share one `OpenAiProvider` implementation
  behind the existing provider-adapter pattern (ADR-008's shape, applied to AI:
  one interface, one file allowed to import the OpenAI SDK, enforced by the
  conformance check) — see the slice 1 implementation plan for where this module
  lands (deferred to a later slice; not built in slice 1).
- The golden-fixture accuracy numbers Spike B produces are specific to whichever
  OpenAI model is targeted at the time it runs; a future model upgrade should
  re-run Spike B's scoring, not assume accuracy carries over.
