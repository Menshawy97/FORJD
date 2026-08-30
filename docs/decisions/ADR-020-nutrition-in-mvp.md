# ADR-020: Nutrition enters MVP scope, sequenced after Phase 2

**Status:** Accepted
**Date:** 2026-08-30
**Overturns:** `docs/product/mvp.md`'s "Explicitly NOT in the beta" list, which named
nutrition tracking

## Context

`docs/product/mvp.md` excluded nutrition from the limited Android beta and argued the case
explicitly: nutrition is "additive, not load-bearing for the core value proposition." The
core loop the MVP set out to validate was *connect health data, train, measure, analyze,
improve*, and food logging sits outside it.

The design revision of 2026-08-30 adds six nutrition screens to the prototype:
`s_nutrition` (3496), `s_foodSearch` (3646), `s_foodDetail` (3685), `s_savedMeals` (3738),
`s_editMeal` (3835), `s_nutritionShare` (3777). It also adds a "Nutrition Today" calorie ring
to the Home dashboard, as the second card on the app's most-visited screen.

That placement is the argument. A feature reachable only from a settings menu can be deferred
without the rest of the app noticing. A card on Home, above the stat grid, is part of the
first screen every user sees; building Home "as designed, minus one card" means building Home
twice.

The product thesis in `docs/product/vision.md` also bends toward it. FORJD's bet is one
canonical model instead of three separate apps. Food is the third app most people in this
audience already have open.

## Decision

**Nutrition is in MVP scope, and is built immediately after Phase 2 (exercise database)
completes** as **Phase 2.5**, not by renumbering Phases 3 through 11.

The numbering matters. Phases 3 through 11 are cited by number across the roadmap, every
screen spec, the handoff bundle, and several ADRs. Renumbering to insert a phase would
invalidate every one of those references to buy nothing but tidiness. A fractional phase is
cheaper and unambiguous.

**Nutrition is not a tab.** The revised prototype's tab bar is the same five entries in the
same order (Home, Train, Progress, Rank, Profile); nutrition is reached from the Home card
via `goNutrition`. The five-tab shell is hardcoded in at least four docs and in
`apps/mobile/src/components/tab-bar.tsx`, and none of them change.

**Auto-calculated macro goals ship degraded until Phase 5.** The prototype's
`autoGoalsFromInbody` (lines 1250-1262) computes `tdee = bmr * 1.45` from the InBody scan's
basal metabolic rate, then applies a per-goal kcal delta (`Lose fat -500`, `Build muscle
+250`, `Get stronger +100`, `Improve endurance +150`, `Feel better 0`) and a protein g/kg
table. InBody is Phase 5. Until it lands, the "Auto-calculate" row is either hidden or
disabled with honest copy. It is **not** shipped computing from the prototype's default
constants (`bmr` defaulting to 1800, weight to 80), because a number presented as
"calculated from your scan" that was in fact calculated from a placeholder is worse than no
number at all.

## Alternatives rejected

**Build nutrition before Phase 2.** Phase 2 is mid-flight (Phases 0, A, B, C merged; D next),
with a vendored dataset, migrations and a tested repository already on `main`. Pausing it
would strand that work half-built, which is the "adjacent features while you're in there"
pattern CLAUDE.md forbids, applied at phase scale.

**Keep nutrition out and ship Home without the card.** Costs a second pass over Home later,
and Home is the screen where a missing card is most visible. The card is also the only entry
point to the feature, so deferring it defers the feature entirely. This is not a partial
ship, it is the same deferral with extra work.

**Make nutrition a sixth tab.** Not what the design draws, and the five-tab bar is asserted
in four docs plus shipped code. Adding a tab would be a change nobody requested.

**Ship auto-calculated goals now using the prototype's fallback constants.** Rejected above:
it presents an invented number as a personalised one. The degraded path is honest.

## Consequences

- `docs/product/mvp.md`'s exclusion list and its "Why this scope" rationale both change. The
  paragraph arguing nutrition is "additive, not load-bearing" is no longer the project's
  position and is replaced rather than quietly deleted.
- The MVP grows by six screens and a full backend vertical (tables, domain, repository,
  contracts, endpoints), pushing the ~38-week beta timeline out. The timeline table gains a
  Phase 2.5 row rather than pretending the work is free.
- **The food database source is an open decision, deliberately not made here.** The prototype
  ships 38 hardcoded rows in `FOODS`, which is a demo, not a product. Choosing a real source
  (Open Food Facts, USDA FoodData Central, or another) is its own ADR at Phase 2.5 planning
  time, and it inherits the same share-alike licence question ADR-005 and ADR-018 already
  have queued for exercise data.
- Nutrition data is **health data** under CLAUDE.md rule 15 and Apple Guideline 5.1.3(i). It
  never reaches an analytics or advertising SDK. `s_nutritionShare`, which exports an image
  of the user's intake, is a deliberate user-initiated export, not an exception to that rule.
