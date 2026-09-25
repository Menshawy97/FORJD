# Lane 6 — Domain calculations (2026-09-25, at b1f006a)

### L6-1 — `suggestDailyTargets` has no minimum-calorie safety floor
- **Severity:** high
- **Where:** `packages/domain/src/nutrition-targets.ts:74-93` (called from `apps/api/src/nutrition/macro-suggestion.ts:87-92`)
- **Scenario:** a small sedentary user (BMR ~900-1150, `mostly_sitting` ×1.4, `lose_fat` −15% or `recomposition` −5%) is offered a target under ~1,200 kcal with a one-tap "Use" button. The domain spec's own `tiny` case (`nutrition-targets.spec.ts:86-90`) produces 1,197 kcal and asserts it as expected.
- **Rule / ADR:** none in CLAUDE.md; the project's rule that health guidance ships only with approved citations (`scan-height-age-plan.md` §4.5 documents every constant but no floor).
- **Evidence:** no clamp in `nutrition-targets.ts:74-93`; no minimum-kcal constant anywhere in the suggestion path (api `nutrition/`, mobile `suggestion-card.tsx`).
- **Suggested fix:** a documented, cited minimum (e.g. 1,200 kcal, or sex/BMR-scaled), clamped before macros are derived; the number approved by the user like the other constants.
- **Known gap?** no

### L6-2 — `ageInYears` uses the server's local calendar day
- **Severity:** low (unconfirmed: server timezone not verified)
- **Where:** `packages/domain/src/age.ts:16-36`
- **Scenario:** near a birthday, a user far from the server's timezone is aged a day early or late (16+ gating, BMR).
- **Suggested fix:** derive "today" from the user's local date.
- **Known gap?** no

## Checked and clean
BMI; Katch-McArdle and Mifflin-St Jeor BMR (midpoint when sex unknown); FFMI and height-adjusted FFMI; Epley 1RM (10-rep cap, reps-1 bug fix from ADR-038 holds); training volume; run haversine distance, jitter filter, splits, elevation gain, net climb; ACSM run/walk calories; Keytel HR calories (90 bpm gate, active energy, non-negative clamp); readiness (HRV log, 7/60-day windows, SWC 0.5, zero-variance handling); leaderboard Activity score and percentiles (MIN_COHORT_SIZE 5, NaN sanitised); muscle-split largest-remainder rounding; unit conversions single-sourced in `packages/domain`; InBody height/age extraction bounds; weight-lookup bounds agree between mobile `latest-weight.ts` and api `macro-suggestion.ts` (duplicate, consistent, cross-referenced); macro math (protein g/kg, 25% fat, carbs remainder ≥ 0).

## Not reached
Some spec files in full; `activity-level.tsx`/goal screens; the leaderboard job's input assembly; whether `apps/api/src/workouts/workouts.repository.ts` duplicates Epley (grep hit, not opened).
