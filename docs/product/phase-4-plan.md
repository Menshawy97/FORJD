# Phase 4 — Progress (Strength): plan

## Context

Phase 3 (the workout engine) closed 2026-09-06 (PRs #115, #116) — see `phase-3-plan.md` and
the roadmap's "Session close, 2026-09-06" entry. FORJD produces longitudinal training data for
the first time, and this phase is the first real construction of the fourth of CLAUDE.md's
four architecturally-critical pillars: the longitudinal analytics model, until now prose only
in `docs/architecture/analytics.md`.

**Why this phase and not the roadmap's next row.** Both Phase 5 (InBody) and Phase 6 (Health
Connect) are externally blocked: Spike B has never run and needs the user's own hand-labelling
plus an OpenAI key; Health Connect cannot merge without a physical Android device (CLAUDE.md
rule 16), which the user does not currently have. Progress-Strength needs neither — no device,
no credential, no paid service, no new native dependency, no migration.

**Scope:** the Progress tab shell (Strength/Body/Health) and the Strength view. Body and
Health render honest-empty, matching Home's established pattern. The "Your week" screen is a
separate route pushed from Home and is not part of this phase.

## Locked decisions

See the plan approved at the start of this phase (preserved in full in the session's plan
file) for the complete reasoning. Summary:

1. **PR tiles show the athlete's two most recently achieved records**, headed by exercise
   name — not a fixed Bench/Squat pair.
2. **The insight card is rules-based and named "FORJD Insight"**, on both Home and Progress —
   not "AI insight". See ADR-030 for the full evidence base.
3. **Insight copy is descriptive, with exactly one instruction** (the ACSM 2-10% load-increase
   rule) — never a deload prescription, never an injury-risk claim.
4. **Progress-Strength is computed on read**, no rollup table, no scheduler — ADR-029.
5. **Weights render in kg** throughout, matching the design's own labels.
6. **Calendar buckets: `running` → Run, everything else → Strength.**
7. **Muscle split divides a set's volume equally** across its exercise's mapped buckets.
8. **`estimateOneRepMaxKg`'s rep cap tightened from 12 to 10**, per the 1RM-accuracy literature
   (ADR-030, R7/R8).

## What was built

- **Slice A — domain.** `packages/domain/src/progress-calculations.ts` (muscle-bucket mapping,
  volume distribution, largest-remainder percentages) and `progress-insight.ts`
  (`evaluateInsight`, with negative tests asserting the forbidden claims never appear).
- **Slice B — contracts.** `progressStrengthQuerySchema` / `progressStrengthResponseSchema` in
  `packages/contracts/src/index.ts`, built from the Slice A tuples, plus a pinned fixture.
- **Slice C — API.** `GET /workouts/sessions/progress/strength` —
  `ProgressRepository`/`ProgressService`/a new controller route, sharing `WorkoutsRepository`'s
  calendar helpers (exported for reuse). Proven against real Postgres (cross-user isolation,
  unticked-set exclusion, the two-consecutive-sessions `readyToProgress` rule) and over real
  HTTP (route-capture safety, an uploaded session visible moments later).
- **Slice D — shared UI.** `SegmentedControl` (both `segStyle()`/`miniSegStyle()` sizes,
  including the mini variant's lack of a shadow); `Sparkline` moved to `components/` with a
  `color` prop; `VolumeBars` and `TrainingCalendar`.
- **Slices E/F — the screen.** `apps/mobile/src/app/(tabs)/progress.tsx` replaces the
  placeholder: PR tiles, the estimated-1RM sparkline, weekly volume, the training calendar,
  the muscle split, an honest-empty step-count card, and FORJD Insight. Body/Health tabs
  render honest-empty explanations. Home's insight card renamed to "FORJD Insight" alongside.

## Verification

`TZ=UTC pnpm --filter @forjd/mobile test --ci --watchAll=false`, `pnpm typecheck`, `pnpm lint`,
`pnpm conformance`, the API unit and e2e suites (`--runInBand`), and a real bundle export —
all green as of this phase's merge. One pre-existing, unrelated flake
(`workouts.repository.spec.ts`'s `listForUser` keyset-pagination test) was found and confirmed
unrelated by reverting this phase's one touched line in that file and reproducing the failure
identically; spun off separately rather than fixed here.

**Device walk** (handed over, not waited on): confirm the calendar lands sessions on the day
trained in the device's own zone, and that Body/Health read as deliberately empty.

## Follow-ups recorded for later phases

- **ADR-031** records the readiness-score evidence base for Phase 6, so that phase starts from
  research rather than re-deriving it under schedule pressure.
- Weight display is kg-only on this screen; per-exercise `WeightDisplayUnit` (ADR-016) has no
  clean meaning on a screen aggregating across exercises, and was deliberately not attempted.

## Related

- [`../decisions/ADR-029-progress-analytics-computed-on-read.md`](../decisions/ADR-029-progress-analytics-computed-on-read.md)
- [`../decisions/ADR-030-forjd-insight-rules-based-not-ai.md`](../decisions/ADR-030-forjd-insight-rules-based-not-ai.md)
- [`../decisions/ADR-031-readiness-score-methodology.md`](../decisions/ADR-031-readiness-score-methodology.md)
- [`../design/progress-screen-specs.md`](../design/progress-screen-specs.md)
- [`phase-3-plan.md`](phase-3-plan.md) — the phase this one follows.
