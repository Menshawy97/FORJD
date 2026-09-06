# ADR-031: Readiness-score methodology for Phase 6 (recorded now, from evidence)

**Status:** Proposed — recorded during Phase 4, to be implemented in Phase 6
**Date:** 2026-09-06

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

The design's demo score ("87" / "Good") remains a mock. Nothing here is built by this ADR;
Phase 4 only records the evidence for Phase 6 to build against.

## Consequences

- Phase 6's implementation has a documented starting point instead of an ad hoc one, reducing
  the risk of shipping a WHOOP-style opaque score the project's own architecture doc already
  argues against.
- The four-input, sleep-window measurement approach implies Phase 6 needs sleep-stage and
  respiratory-rate data types from Health Connect / HealthKit, not just HRV and steps — worth
  confirming against `docs/architecture/health-data.md`'s declared data types when that phase
  starts.

## Related

- [`../architecture/analytics.md`](../architecture/analytics.md) — "no single opaque health
  score", the rule this ADR's decision satisfies.
- [`../architecture/health-data.md`](../architecture/health-data.md) — source-priority policy
  and data-type declarations Phase 6 will need.
- [`ADR-004-canonical-health-model.md`](ADR-004-canonical-health-model.md) — `HealthObservation`,
  whose `source` field is what R10's consequence depends on.
- [`ADR-030-forjd-insight-rules-based-not-ai.md`](ADR-030-forjd-insight-rules-based-not-ai.md) —
  the companion research this ADR was written alongside.
