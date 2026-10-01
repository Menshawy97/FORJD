# Weekly Forge: fewer levels, explained in the app, shareable any time

**Status: done (2026-09-28).** Approved by the user on 2026-09-27 (mock-up parts A–H and sources R1–R6).
- X1 docs: merged (#304).
- X2 table and refold: merged (#305), `main` green, deployed to staging and, with the owner's
  go-ahead, to production (no stored weeks there needed refolding). The owner's local example
  history was refolded too.
- X3 How it works, ladder screen, ways in: merged (#306), `main` green.
- X4 sharing: merged (#307), `main` green.
- X5 FAQ section: merged (#308), `main` green.
- **Still owed:** checking real share capture on a dev-client build (ADR-028). Expo Go can't
  capture, so its Share buttons only say "Sharing works in the full app, not in Expo Go."
- The app-only phases (X3–X5) reach production with the next app build; there is no mobile
  deploy to run.
**Mock-ups:** [Weekly Forge Explainer](https://claude.ai/artifact/WtAfKpW3tTZWsbqV32yXDf) (claude.ai artifact, private to the owner).
**Decision record:** [ADR-058](../decisions/ADR-058-weekly-forge-fifteen-levels.md).
**Builds on:** [weekly-forge-plan.md](weekly-forge-plan.md) and [ADR-057](../decisions/ADR-057-weekly-forge.md).

## Why

On the device, the owner found Weekly Forge hard to understand. The app showed "Ember · Level 7", but
nothing explained what a level or a band is, or what the week would do. Three problems came out of it:

1. **Too many levels.** Volume and Distance had 33 levels and Active minutes 25. The top goals
   (106,600 kg, 277 km a week) are beyond almost everyone, so Forged was out of reach.
2. **No explanation in the app.** No screen, no FAQ entry.
3. **No way to share outside a celebration.** The share card was only offered on the one-off
   new-band and Forged screens.

## What was decided

| # | Decision |
|---|---|
| D1 | Volume, Distance and Active minutes get **3 levels per band, 15 in total**. Consistency and Nourish are unchanged. |
| D2 | Band starts are pinned to published sources R1–R6 (see ADR-058). The Volume kilograms are an estimate built from those sources' sets and reps, and the owner accepted that. |
| D3 | Existing levels are **recomputed from the stored weekly totals** under the new table. Past weeks are rewritten with their new level, goal and outcome, and `rules_version` 2. Totals never change. Rewards already earned are kept (the ledger is append-only). |
| D4 | A **How it works** screen, opened from an info icon on the Home card. It does **not** open by itself; that's left for the onboarding work (see [onboarding.md](onboarding.md)). |
| D5 | Tapping a ladder row on Home or on your own Profile opens a **ladder screen**: your level, this week's progress, what this week will do, a Share button, and every level's goal grouped by band. |
| D6 | **Sharing from three places:** the ladder screen's Share button, tapping the badge on the ladder screen to replay the band's celebration, and a Share link on the Profile's Weekly Forge section that makes a new all-ladders card. Nourish is never shared. |
| D7 | The **public athlete profile is unchanged**: band, level, earned badges and the Forged record for four ladders. Other people can't open the ladder screen, and those rows aren't tappable. |
| D8 | A **Weekly Forge section in the FAQ** (nine questions, wording in faq-copy.md), shown only when the `weekly_forge` flag is on. |

## The new table (packages/domain/src/forge-tiers.ts)

| Ladder | Ore (L1–3) | Ember (L4–6) | Anvil (L7–9) | Tempered (L10–12) | Forged (L13–15) |
|---|---|---|---|---|---|
| Volume kg | 2,000 · 3,000 · 4,000 | 5,500 · 7,500 · 10,000 | 13,000 · 17,000 · 22,000 | 28,000 · 35,000 · 43,000 | 52,000 · 62,000 · 75,000 |
| Distance km | 5 · 8 · 12 | 16 · 21 · 27 | 34 · 42 · 52 | 63 · 75 · 88 | 100 · 115 · 130 |
| Minutes | 60 · 90 · 120 | 150 · 190 · 230 | 300 · 360 · 420 | 480 · 560 · 640 | 720 · 810 · 900 |
| Consistency | 1 · 2 | 3 | 4 | 5 | 6 |
| Nourish days | 1 · 2 | 3 · 4 | 5 · 6 | none | none |

Consistency and Nourish keep their current values and level numbers.

## Phases

Each phase: tests first, code-review agents, a PR, green CI, merge, then the CI run on `main`
confirmed green. API phases also need the automatic staging deploy to pass. **A production
deploy is dispatched only with the owner's go-ahead for that deploy.**

### X1. Docs (docs only)

- This plan.
- `docs/decisions/ADR-058-weekly-forge-fifteen-levels.md`: the table, the sources, the kilogram
  estimate, and the recompute. ADR-057 gets an "Amended by ADR-058" line on decision 6.
- `docs/product/onboarding.md`: the note that How it works may open once during onboarding later.
- `docs/product/faq-copy.md`: the approved Weekly Forge section.
- `docs/product/roadmap.md`: the Weekly Forge entry says the flag is **on** (PR #303), and links here.

### X2. The table and the recompute (domain + API)

**Domain, tests first:**
- `forge-tiers.spec.ts`: rewrite the value checks. Every ladder's levels rise strictly; Volume,
  Distance and Minutes have exactly 3 levels per band and 15 in total; Consistency and Nourish are
  unchanged; the pinned band starts (150 and 300 minutes, 16 and 100 km) are asserted by value, so a
  later edit can't drift from ADR-058 unnoticed. The old "12% ±1% per level" check is removed.
- `forge-tiers.ts`: the new values. Its doc comment points to ADR-058.
- `forge-evaluation.ts`: `FORGE_RULES_VERSION` becomes 2.
- **New `refoldLadder(ladder, weeks)`** in `forge-evaluation.ts`: takes one athlete's stored weeks
  for one ladder in order (week start and locked total), folds them through `evaluateWeek` from
  `initialForgeState()`, and returns every week's result plus the final state. Pure and fully unit
  tested: an empty history, a long miss run, a climb that crosses into Forged through the 4-week
  hold, and an old level 20 that ends up inside the new 15.
- **New `forgeWeekOutlook(ladder, level, total)`** in the same package: returns what the week will
  do if it closed now. The ladder screen's line comes from this, so it uses the same rules as the
  server. Tests cover a hit, an overshoot, the +3 cap, the top level, and the Forged hold.

**API, tests first:**
- `ForgeRefoldRepository` (new): per athlete and ladder, in one transaction, reads the weeks in
  order, rewrites each `forge_weeks` row's level, band, target, outcome, streaks and
  `rules_version`, then writes `forge_user_ladders` from the final state. It inserts any new rewards
  with the ledger's existing `on conflict do nothing`, and never deletes one. It only touches
  athletes with a week whose `rules_version` is below the current one, so a second run changes
  nothing.
- `apps/api/src/forge/refold/refold.ts` (new script, `pnpm forge:refold`), shaped like `forge:seed`:
  it runs every athlete with stale weeks and prints a count. Spec plus a repository spec against
  the test database.
- `deploy-api.yml`: run `forge:refold` right after `forge:seed`, with a comment explaining why the
  order matters (the seed must have pruned levels 16–33 first).
- No schema migration: the columns already exist.
- **One additive contract field.** `GET /forge` ladders gain an optional `temperedHoldWeeks`
  (already stored in `forge_user_ladders`). Without it, the ladder screen could promise Forged at
  the top of Tempered before the 4-week hold is complete. It is optional in the schema, so an app
  build that predates it still parses the response (rule 7). Everything else keeps its shape; only
  the numbers change.
- Verify: the domain tests, the API unit and e2e suites, lint, build, the architecture
  conformance check, and a local run of `forge:seed` then `forge:refold` against the local
  database, checking the owner's example history lands inside 15 levels.

### X3. How it works and the ladder screen (mobile)

- `app/forge/how-it-works.tsx` (new route): mock-up C.
- `app/forge/[ladder].tsx` (new route): mock-ups D and E. The ladder param is validated against
  `FORGE_LADDERS`, and an unknown value goes back to Home. The level list comes from `FORGE_TIERS`
  in `@forjd/domain`, so it works offline. The top card comes from `useForgeWeek()`, and its
  loading and failure states are mock-up E's can't-load version.
- `components/icon.tsx`: a new `info` glyph (circle r 7.8, stem and dot, 1.6 line).
- `weekly-forge-card.tsx`: the info icon after the label (44 × 44 tap area, "How Weekly Forge
  works"), and rows become `Pressable` with the existing press feedback, opening the ladder.
  Pending rows stay inert.
- `forge-profile-rows.tsx`: rows can be tappable (own profile only, D7). The public section passes
  nothing, so its rows stay inert.
- Tests: route guards, every state drawn, tap targets, accessibility labels, and the outlook line
  for each ladder shape.

### X4. Sharing (mobile)

- Ladder screen Share button: captures the existing `ForgeShareCard` off screen and opens the share
  sheet through `media/share-capture`, as the celebration does today. Hidden for Nourish.
- Badge replay: tapping the ladder screen's badge opens `ForgeCelebrationScreen` for the current
  band (or Forged). Its props narrow from a stored week to what it draws (ladder, band, level,
  target, and the week label or none), so a replay needs no fake week. It isn't offered for
  Nourish, or while the level can't load.
- Profile Share link and the new `ForgeShareAllCard` (mock-up F2): the same 300 × 375 frame, glow and
  footer, with four 40 px badge rows. The glow is white-hot when any public ladder is Forged. It never
  renders Nourish, whatever it's given (the same guard as `ForgeShareCard`).
- Tests: Nourish is never drawn or offered, the replay reaches Continue, and share failures show
  the existing error line.

### X5. FAQ section (mobile)

- `features/faq/faq-content.ts`: a `Weekly Forge` section with the nine approved entries, after the
  Rank section, filtered out while the flag is off.
- The last answer links to How it works.
- Tests: the section is hidden with the flag off, and every entry renders.

## Checkpoints and the phone

- After X2 merges and deploys to staging, the owner's local API needs the new code and a local
  `forge:seed` and `forge:refold` run. The main checkout is fast-forwarded only when it's idle, per
  the shared-checkout rule.
- After X3–X5, the owner checks on the phone in Expo Go. Share capture already needs a dev-client
  build (ADR-028), so the Share buttons show the existing Expo Go notice there.
