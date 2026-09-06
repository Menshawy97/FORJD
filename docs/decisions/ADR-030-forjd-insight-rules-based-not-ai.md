# ADR-030: FORJD Insight is rules-based, not an AI model, and every claim it can make is evidence-backed

**Status:** Accepted
**Date:** 2026-09-06

## Context

The design's Progress-Strength screen (`progress strength 3.png`) and Home dashboard both
carry a card headed "AI insight", with demo copy: *"Training volume up 14% this week. HRV has
remained stable at 67–68 ms, suggesting you are absorbing the load well. Continue this
trajectory for 2–3 more weeks before deloading."*

Building this card for real, in Phase 4, meant choosing between three approaches: wire up the
OpenAI adapter ADR-014 describes and generate the sentence with a real model call; leave the
card honest-empty, the same treatment Home's readiness card and health metrics already get
while waiting on Phase 6; or generate the sentence from the numbers the app already
computes, using fixed rules. The user chose the third option, with two conditions: the card
must not be labelled "AI" if it is not AI, and any claim it makes about training must be
backed by published sources the user has seen and approved.

## Decision

**The card is named "FORJD Insight", not "AI insight", on both Home and Progress.** Its
sentence is the output of `evaluateInsight` in `packages/domain/src/progress-insight.ts`, a
pure function over the athlete's own numbers (training volume this week vs. last week,
sessions per week, an estimated-1RM trend, and whether a lift has run past its target reps for
two consecutive sessions). No LLM, no network call, no cost per request. Calling it "AI" would
be a false claim about how the app works.

### The evidence base

Every rule the function can apply, and the literal copy it can emit, is anchored to one of the
following. Two counter-findings (R4, R5) exist specifically to constrain what the card must
**never** say, not to support anything it does say.

| # | Source | What it supports or forbids |
|---|---|---|
| R1 | ACSM Position Stand, *Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews*, Med Sci Sports Exerc, April 2026 | ~10 sets per muscle group per week for hypertrophy; train each major muscle group at least twice per week. Backs the "twice a week" frequency note the card adds to a thin training week. |
| R2 | ACSM Position Stand, *Progression Models in Resistance Training for Healthy Adults*, Med Sci Sports Exerc 2009;41(3):687–708 | The 2–10% load-increase rule, applied once the athlete exceeds the target reps by one or two on two consecutive sessions. **The one instruction the card is allowed to give.** |
| R3 | *The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains*, Sports Medicine 2025, doi:10.1007/s40279-025-02344-w | Gains rise with weekly volume but with diminishing returns, markedly so for strength. Backs reporting a volume rise as a plain observation, never as "more is always better". |
| R4 | *Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations*, PeerJ 2024;12:e16777 | **Counter-evidence.** Continuous training produced greater strength gains than deloading in this study. The card must never prescribe a deload — the design's own demo copy does, and that copy is not supported. |
| R5 | Impellizzeri et al., *Analyzing Activity and Injury: Lessons Learned from the Acute:Chronic Workload Ratio*, 2020, and the ACWR meta-analysis literature | **Counter-evidence.** The "sweet spot" ratio that frames a load spike as an injury risk is a statistical artefact of bucketing continuous data; the relationship disappears when the data are treated continuously. The card must never assert that a volume increase raises injury risk. |
| R6 | Hornsby, Gentles, Comfort, Suchomel, Mizuguchi & Stone (2018), *Resistance training volume load with and without exercise displacement*, Sports 6(4):137 | Confirms `sets × reps × load` as the standard volume-load formula, which `sessionVolumeKg` and the new Progress-repository volume queries already implement. |
| R7 | DiStasio's validation of the Brzycki and Epley equations against a measured back-squat 1RM; the seven-equation accuracy comparison in sedentary older adults | Confirms Epley (already used by `estimateOneRepMaxKg`) is a validated estimator, closest to measured 1RM at low reps. |
| R8 | Same sources as R7 | Prediction accuracy degrades materially above roughly ten repetitions. |

**R8 changed shipped code.** `estimateOneRepMaxKg`'s `MAX_ESTIMABLE_REPS` was 12; the evidence
supports 10. Tightened as part of this phase, with `training-calculations.spec.ts` updated to
match — a correctness fix, not a behavior regression, since a set that ran to 11 or 12 reps
was always the estimator's least reliable input.

### What the card must never say

Enforced by tests, not only by the prose above: `progress-insight.spec.ts` asserts, across
every input shape the function can be given — including a quadrupled week-over-week
volume — that the output never contains "deload", "de-load", "injury", "injured",
"overtrain", "at risk", or "overreach". A very large volume jump is reported as what it is
(a percentage), never escalated into a warning.

## Consequences

- No new vendor dependency, no per-request cost, no new integration surface in a phase that
  otherwise has none.
- The card's language is necessarily more conservative than the design's demo copy — it
  reports facts and gives one instruction (R2's load bump) rather than offering the kind of
  broad training-plan advice a real model might phrase more fluently. This is a deliberate
  trade of fluency for defensibility.
- If OpenAI-backed insight generation is built later (per ADR-014, for InBody and originally
  for these cards too), that work should reuse the same evidence base and constraints
  documented here rather than re-deriving them, and the card's own heading should say "AI"
  only once it genuinely is.

## Related

- [`../product/phase-4-plan.md`](../product/phase-4-plan.md) — the plan this ADR was written
  alongside, including the full reference list with URLs.
- [`ADR-014-openai-inbody-vision.md`](ADR-014-openai-inbody-vision.md) — the standing decision
  on AI vendor choice for the day this card (or InBody extraction) does use a model.
- [`ADR-031-readiness-score-methodology.md`](ADR-031-readiness-score-methodology.md) — the
  companion research for Home's readiness score, recorded now for Phase 6.
- `packages/domain/src/progress-insight.ts`, `progress-insight.spec.ts`.
