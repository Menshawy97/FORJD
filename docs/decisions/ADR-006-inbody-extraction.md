# ADR-006: InBody photo extraction via Claude vision

**Status:** Superseded by ADR-014 (2026-08) — vendor changed to OpenAI vision;
pipeline shape and confirmation-gate requirement carry over unchanged.
Was: Proposed — pending Spike B (Phase 0, week 1-3)

## Context

`FitnessApp.md` §14 warns against a photo → LLM → JSON pipeline as the
*only* extraction mechanism, because a single OCR/vision mistake on a
digit (84.6 vs 34.6 vs 84.8) silently corrupts a user's long-term progress
graph. The later planning pass (`forjd-detailed-plan_1.md` §3b) proposes
Claude vision as the *primary* extractor specifically because it can ship
in v1 without months of building a deterministic layout parser.

This ADR resolves that tension (see the plan's decision D1): Claude vision
is accepted as primary, but only conditioned on the confirmation gate being
mandatory and on measured field-level accuracy, not assumed accuracy.

## Decision

**Extraction approach accepted; production readiness pending Spike B.**

Pipeline (see `docs/architecture/health-data.md` for full detail):

```
Photo upload → image quality check → Claude vision extraction
(structured JSON with per-field confidence) → confidence scoring
→ mandatory confirmation screen → user-confirmed BodyScan record
```

Non-negotiable: nothing saves unconfirmed. High confidence pre-fills a
field the user must still tap to confirm; low confidence leaves it blank,
forcing the user to type it. This is what makes "AI as validator, not sole
source of truth" (`FitnessApp.md` §14's real requirement) survive the
architectural reversal — the confirmation step carries the weight the
deterministic parser would otherwise have carried.

## Spike B — required before this ADR can be marked Accepted

- Collect 10-15 real InBody report photos: varied models (270/570/770),
  lighting, angle, glare, partial crops.
- Extract via Claude vision into structured JSON (weight, body fat %,
  skeletal muscle mass, BMI, visceral fat, body water, per-field confidence).
- Score **per-field accuracy** against hand-labelled ground truth — not
  document-level accuracy, which would hide exactly the failure that
  matters here.
- Specifically check whether confidence scores correlate with actual
  errors. If they don't, the confidence gate is decorative and needs
  redesign before Phase 5 depends on it.

## Consequences (to fill in once Spike B concludes)

- Measured per-field accuracy: _TBD_
- Confidence-score/error correlation: _TBD_
- Any field types requiring a fallback (manual-only entry, no AI pre-fill): _TBD_

The golden-fixture test suite (`tests/fixtures/inbody/`) starts from the
Spike B images (anonymized) and their expected-output JSON, and runs in CI
from Phase 5 onward as the tripwire for silent extraction drift
(`CLAUDE.md` rule 8).
