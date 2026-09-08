# ADR-031: Readiness-score methodology for Phase 6 (recorded now, from evidence)

**Status:** Accepted (2026-09-08) — recorded during Phase 4 as Proposed, implemented in Phase 6
**Date:** 2026-09-06 (Proposed), 2026-09-08 (Accepted, implementation added)

## Context

Home's `readiness-card.tsx` has stood honestly empty since the Home dashboard was built,
because nothing in this repo can compute a readiness score until Health Connect / HealthKit
(Phase 6) supplies HRV, resting heart rate, and sleep. While researching the evidence base for
FORJD Insight (ADR-030), the user asked that the same rigor be applied to readiness before any
of it is built: "think like how WHOOP does it so good."

This ADR is written now, ahead of Phase 6's implementation, so that phase starts from an
evidence base rather than reinventing one under schedule pressure — the same reasoning
`docs/product/phase-3-plan.md`'s open questions already model for decisions made ahead of the
work that depends on them.

## What the evidence says

| # | Source | Finding |
|---|---|---|
| R9 | Plews, Laursen, Stanley, Kilding & Buchheit (2013), *Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring*, Sports Medicine 43(9):773–781, doi:10.1007/s40279-013-0071-8 | HRV should be judged against a 7-day rolling average compared to a longer personal baseline, and against the athlete's own smallest worthwhile change (≈0.5 × their coefficient of variation) — never a single morning reading, and never a population norm. |
| R10 | *Wrist-Based Photoplethysmography Assessment of Heart Rate and Heart Rate Variability: Validation of WHOOP* (PMC8160717); an observational device-comparison study (PMC12819663) | Device accuracy varies materially by sensor type — chest ECG straps outperform wrist PPG. Two providers' HRV readings are not interchangeable numbers. |
| R11 | *Daily Resting Heart Rate Variability in Adolescent Swimmers during 11 Weeks of Training* (PMC7143004) | Day-to-day HRV did not significantly correlate with training volume or sleep duration in this cohort, though a consistent ~4.5% suppression followed 3–5 consecutive high-volume days. Readiness is a trend signal, not a daily verdict. |
| R12 | WHOOP's own published description of how Recovery works | Four inputs, all measured during sleep: HRV (the dominant signal), resting heart rate at deepest sleep, sleep performance (slept vs. needed), and respiratory rate — each compared against the individual's own baseline, never a population average. Exact weightings are undisclosed. |
| R13 | *Accuracy, Utility and Applicability of the WHOOP Wearable Monitoring Device*, systematic review, medRxiv 2024; wearable-transparency literature (PMC12706116) | The inputs (HR, HRV measurement) are well-validated and support longitudinal trend tracking. **The composite recovery score is not**: it "cannot be independently replicated or validated", and in a study of elite swimmers WHOOP's recovery score was not consistently associated with perceived recovery or stress even though the HRV it measured was. |

**The lesson is to copy WHOOP's inputs and measurement discipline, not its opacity.** What is
good about WHOOP — same physiological state measured every night, personalised baselines, four
complementary signals — is exactly what `docs/architecture/analytics.md` already asks for. What
is documented as weak — one undisclosed-weighting number that underperformed its own component
HRV in independent testing — is exactly what that same document already forbids: *"No single
opaque health score... component scores that are individually meaningful."*

## Decision

When Phase 6 implements a readiness score, it will:

1. Use WHOOP's four input categories — HRV, resting heart rate, sleep performance, respiratory
   rate — measured during the sleep window, not at an arbitrary check-in time (R12).
2. Compare each metric against the athlete's own rolling baseline with a smallest-worthwhile-
   change band, not a fixed percentage or a population norm (R9).
3. Surface Recovery, Sleep, and Consistency (and any further components) as separate visible
   figures, with an overall trend derived from them and always decomposable — never a single
   number with no explanation, per `analytics.md`'s existing rule (R13).
4. Preserve source on every observation (CLAUDE.md rule 10; R10) — a chest-strap HRV reading
   and a wrist-PPG HRV reading are not fungible, and the source-priority policy `health-data.md`
   already specifies is what reconciles them, not an average.
5. Withhold the score, with an explicit explanation, until there is roughly a month of history
   for a personal baseline to mean anything — the same honest-empty standard the card already
   uses today (R9, R11) — versioned with a `score_model_version` if a scoring model is
   introduced, per `analytics.md`.

The design's demo score ("87" / "Good") remains a mock at Proposed-time. Phase 4 only recorded
the evidence; the implementation below is what Phase 6 actually built against it.

## Implementation (accepted 2026-09-08) — the formula, and what is and isn't published

Built in `packages/domain/src/readiness.ts` (`computeReadiness`), with a research pass this
session to validate or correct the Proposed decision's five rules against real published
methodology rather than assumption. **Full research citations are in that file's own header
docblock**; this section is the summary a reviewer needs without opening the source.

**What is real, published, and reused here, not invented:**

- **HRV log-transform.** rMSSD is not normally distributed; average/SD is computed on
  `ln(rMSSD)`, not the raw value — standard practice per R9 (Plews et al. 2013) and the
  broader HRV-guided-training literature (Marco Altini's HRV4Training methodology
  independently confirms this).
- **The athlete's own rolling baseline, never a population norm.** Universal across WHOOP,
  Oura, and the academic literature (R9, R12) — confirms the Proposed decision's rule 2.
- **Smallest Worthwhile Change (SWC) = 0.5 x the athlete's own baseline standard deviation.**
  Hopkins (2000)'s SWC formula, applied specifically to HRV by Plews/Buchheit — the threshold
  `readiness.ts` uses for "is today meaningfully different," not an invented cutoff. This is
  the single most directly citable number in the whole implementation.
- **A 60-day baseline window.** The most consistently repeated figure across independent
  HRV-guided-training implementations (Plews/Buchheit, Altini) — sits inside the range other
  approaches use (WHOOP: ~30 days to full calibration; Oura: ~14-day contributor baseline,
  60-day comparison window for its own "balance" contributors).
- **A 30-day minimum before scoring.** "Roughly a month," per the Proposed decision's rule 5 —
  between WHOOP's ~30-day full-calibration figure and Oura's ~14-day contributor baseline, on
  the conservative side of the academic 60-90-day SD-stabilization window.
- **WHOOP's published 0-33% / 34-66% / 67-100% red/yellow/green zone cutoffs.** Confirmed
  public (WHOOP's own training-zones guide) and reused directly — the one part of WHOOP's
  actual scoring that is not a trade secret.

**What is FORJD's own design choice, not derived from any published source — stated plainly,
not dressed up as more authoritative than it is:**

- **How the four components combine into one number.** No company publishes this. WHOOP's
  own developer docs return the score and the raw metrics, never the combination logic
  (`developer.whoop.com/docs/developing/user-data/recovery`); no peer-reviewed multi-factor
  (HRV+RHR+sleep+respiratory) composite with disclosed weights exists to copy either.
  `readiness.ts` uses a transparent, equal-weighted average of four independently-baselined
  components — the user confirmed this approach explicitly after being told plainly that no
  published formula exists to match. An earlier option (weighting HRV more heavily, matching
  WHOOP's public statement that HRV "carries the most weight" with no disclosed number) was
  offered and not chosen.
- **Non-overlapping baseline and recent windows** (baseline = the 60 days immediately
  *before* the 7-day recent window, not including it). Testing surfaced that an
  overlapping design — where the recent days are also counted inside their own comparison
  baseline — dampens exactly the signal the score exists to detect: a real spike pulls the
  baseline mean toward itself, understating its own deviation. Non-overlapping "today vs. the
  period before today" is the more standard framing in the literature this file draws from,
  and was adopted after the overlapping design's dilution effect was caught by the test suite,
  not assumed from the start.
- **The neutral=50, +/-2 baseline SD saturates 0-100 score mapping.** A deliberately simple,
  documented linear mapping — not WHOOP's real (unpublished) curve.

**What real WHOOP/Oura accuracy parity would require, and why it is out of reach**: WHOOP's
combination formula and raw-deviation-to-percentage curve are trade secrets, confirmed
undisclosed across their developer docs, patents (US9750415B2, US9743848B2 — describe *what*
is measured and *when*, not the scoring formula), and public blog content. "Match WHOOP's
accuracy" is not achievable as a literal claim, because there is no published WHOOP output to
benchmark against beyond the final score itself. What this implementation can honestly claim:
every input-processing step (log-transform, smoothing, baseline comparison, SWC threshold) is
grounded in the same published sports science WHOOP's own patents and public statements
describe using — the composite is FORJD's own defensible design, transparent about being one.

**Correctness, verified under heavy testing** (`packages/domain/src/readiness.spec.ts`, 32
cases): the implementation itself needed three real fixes surfaced by testing every boundary,
not just the happy path —

1. A near-zero baseline standard deviation (floating-point noise on 60 repeated
   log-transformed values almost never lands on bit-identical numbers) was dividing by ~1e-16
   instead of a clean zero, amplifying rounding noise into wildly wrong scores. Fixed with an
   epsilon guard.
2. That same guard, applied too bluntly, then suppressed *genuine* zero-variance baselines
   (a metric that has truly never moved in 60 days) — any real deviation from a perfectly flat
   history was being treated as "no change" instead of the maximal deviation it actually is.
   Fixed by distinguishing numerical noise from a real signal against a flat baseline, and
   saturating the latter rather than zeroing it.
3. The zone (red/yellow/green) was originally computed from the unrounded composite, which
   could show a score of "33" in the yellow zone if the true unrounded value were 33.4 —
   contradicting the number on screen. Fixed by zoning the rounded, displayed score.

## Consequences

- `computeReadiness` is a pure domain function — it takes daily readings and an `asOf` date,
  and returns a score/zone/component breakdown or a withheld reason. It does not itself query
  the database; the API layer (health-data module) is what reduces raw `health_observations`
  rows into the one-reading-per-day input this function expects, and is not yet built as of
  this ADR's acceptance — tracked as follow-up work, not part of this decision.
- The four-input, sleep-window measurement approach means Health Connect/HealthKit data types
  for sleep stages and respiratory rate are required, not just HRV and steps — already reflected
  in `packages/domain/src/health-vocabulary.ts`'s `HEALTH_METRIC_TYPES` (Phase 6A).
- Every component stays separately visible (score, label, raw recent value) even when the
  composite itself is withheld — satisfies `analytics.md`'s "no single opaque health score"
  rule literally, not just in spirit: a user with 3 of 4 components ready still sees those 3.
- The composite's exact formula (equal-weighted average, non-overlapping windows, the 0-100
  saturation curve) is FORJD's own, not WHOOP's or Oura's actual algorithm — if that mapping is
  ever revised (e.g., weighting HRV more heavily, matching WHOOP's public "HRV weighted most"
  statement), it changes one file with 32 tests protecting the change from a silent regression,
  and should be recorded as an amendment here, not a silent edit.

## Related

- [`../architecture/analytics.md`](../architecture/analytics.md) — "no single opaque health
  score", the rule this ADR's decision satisfies.
- [`../architecture/health-data.md`](../architecture/health-data.md) — source-priority policy
  and data-type declarations Phase 6 will need.
- [`ADR-004-canonical-health-model.md`](ADR-004-canonical-health-model.md) — `HealthObservation`,
  whose `source` field is what R10's consequence depends on.
- [`ADR-030-forjd-insight-rules-based-not-ai.md`](ADR-030-forjd-insight-rules-based-not-ai.md) —
  the companion research this ADR was written alongside; same "cite evidence, no AI-washing"
  discipline this ADR's implementation follows for a rules-based statistical computation.
- `packages/domain/src/readiness.ts` — the implementation, with full research citations in its
  own header docblock.
- `packages/domain/src/readiness.spec.ts` — 32 tests, including the three real bugs the
  boundary-testing pass in this section's own "Correctness" paragraph found and fixed.
