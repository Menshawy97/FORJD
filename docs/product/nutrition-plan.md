# Phase 2.5 — Nutrition: plan and execution

## Context

The 2026-08-30 design revision added six nutrition screens plus a "Nutrition Today" calorie
card on the Home dashboard. The user decided nutrition is **in MVP scope, built immediately
after Phase 2 completes** — recorded as [ADR-020](../decisions/ADR-020-nutrition-in-mvp.md),
which overturns `mvp.md`'s previous exclusion.

It is numbered **2.5** rather than inserted as a new Phase 3. Phases 3 through 11 are cited
by number across the roadmap, every screen spec, the handoff bundle and several ADRs;
renumbering would invalidate all of it to buy nothing but tidiness.

The design source of truth is [`../design/nutrition-screen-specs.md`](../design/nutrition-screen-specs.md),
extracted from the runnable prototype. **The prototype outranks that spec, and both outrank
the `design_handoff_forjd_mobile/*.md` bundle, which predates the revision entirely and does
not mention nutrition at all.**

The intended outcome: a user can set daily calorie and macro goals, search a real food
database, log food into Breakfast / Lunch / Snack / Dinner, save and re-log recurring meals,
and see today's totals on Home and on the nutrition dashboard.

## Starting position

Nothing exists. There are no food, meal, or nutrition tables, contracts, or routes — the
backend today is auth, one profile, privacy consent and one public-athlete read, eight routes
in total. This is a complete vertical, not an extension.

What *does* transfer from Phase 2, and should be reused rather than rediscovered:

- The `exercises` table's shape for a **user-owned-or-catalogue** record: one table with a
  nullable `owner_user_id` (null = catalogue row), partial unique indexes, and `deleted_at`
  soft delete. Custom foods have exactly this shape.
- Postgres full-text search via a generated `search_vector` column plus a GIN index, and a
  `pg_trgm` trigram index on the name — migration `0006` is the worked example.
- On-device search with `expo-sqlite` + FTS5 and a version-gated catalogue sync, if food
  search needs to work offline. **Decide this explicitly; see open questions.**
- The `ZodValidationPipe(schema)` + `packages/contracts` + pinned-fixture pattern used by
  every existing endpoint.

## Locked decisions

Made during this planning pass. Do not re-litigate without a new ADR.

| Decision | Choice |
|---|---|
| Tab placement | **Not a tab.** Reached from the Home calorie card. The five-tab bar does not change. |
| Meal slots | Fixed four — `Breakfast, Lunch, Snack, Dinner`, **Snack third**, matching `SLOTS` |
| Macro goals | Stored per user, editable, with sensible defaults. **Not** derived on read |
| Auto-calculated goals | **Ship degraded until Phase 5.** InBody data does not exist, so the Auto-calculate row is hidden or disabled with honest copy — never computed from the prototype's 1800 kcal / 80 kg fallbacks (ADR-020) |
| Custom foods | Same table as catalogue foods, nullable `owner_user_id`, per the `exercises` precedent |
| Saved meals | A named, ordered list of food entries owned by a user; logging one **copies** its items into the day's log rather than referencing it, so editing a saved meal never rewrites history |
| Grouped log entries | Items logged together from a saved meal share a `group_id` so the dashboard can collapse and delete them as one |
| Units | Energy follows the profile's existing `energyUnit` (`kcal` / `kJ`, ADR-016). Macros are always grams |
| Nutrition data classification | **Health data** under CLAUDE.md rule 15 — never reaches an analytics or advertising SDK |
| Offline | **Reads may be cached; writes are online-only**, matching Phase 2's decision. The offline sync queue belongs to Phase 3's workout engine |
| `MACRO_GOALS` constant | Dead code in the prototype — model `state.macroGoals` only |

## Build order

Each phase is a vertical slice, test-first, RED confirmed before GREEN, per CLAUDE.md and the
project's standing TDD rule. Each is its own checkpoint: docs updated, PR opened, CI green,
merged, then CI confirmed on `main`.

**Phase A — food database source.** Write the ADR (see open questions), then vendor or wire
the chosen source. This is the decision the rest of the phase depends on and it goes first.

**Phase B — domain vocabulary.** `packages/domain`: meal slots, macro nutrients, the food and
serving types. Pure types and `as const` tuples, no dependencies — the same shape as
`exercise-vocabulary.ts`.

**Phase C — migration, schema and repository.** Tables for foods, servings, the daily log,
saved meals and their items, and per-user macro goals. Search indexes on the food name from
the start, per migration `0006`'s pattern. Repository with unit tests; no HTTP yet.

**Phase D — contracts and endpoints.** Zod schemas in `packages/contracts` with pinned
fixtures, then the NestJS module, service and controller behind `JwtAuthGuard`. Food search,
log read/write/delete, saved-meal CRUD, macro-goal read/write.

**Phase E — the dashboard screen.** `nutrition` plus its three bottom sheets, wired to real
data. Build the **empty state first** — first-run state is an empty log and zero saved meals,
so that is what every new user sees.

**Phase F — food search and detail.** `foodSearch`, `foodDetail`, and the custom-food sheet.

**Phase G — saved meals.** `savedMeals` and `editMeal`.

**Phase H — Home entry point.** The "Nutrition Today" card on the Home dashboard. Sequenced
last of the screens because Home itself is otherwise still a placeholder; if Home has been
built by then, this folds into that work instead.

**Phase I — share.** `nutritionShare`. Pure client rendering, no backend. Lowest priority and
the natural thing to cut if the phase runs long.

## Verification

Per phase: `TZ=UTC pnpm --filter @forjd/mobile test --ci --watchAll=false` (the `TZ=UTC` is
not optional — CI runs UTC and a Phase G test in slice 2 passed locally then failed on CI for
exactly this reason), `pnpm --filter @forjd/mobile typecheck`, `lint`, the API's unit and e2e
suites, and a real bundle compile — Jest does not compile NativeWind or native modules, so a
green suite is not proof the app builds.

Device walk at the end of the phase, on a physical device via Expo Go: set goals, search a
food, log it to Lunch, edit its serving, save a meal, log that meal, delete a grouped entry,
and confirm Home's card matches the dashboard total.

## Open questions — settle before Phase A

1. **Which food database?** The prototype ships 38 hardcoded rows, which is a demo. This
   needs its own ADR, the way ADR-005 handled the exercise dataset. The two realistic
   candidates:

   - **Open Food Facts** — free, no API key, huge packaged-food coverage with barcodes,
     licensed **ODbL**. ODbL is a share-alike licence for the *database*, which raises exactly
     the question ADR-005 already queued for wger and ADR-018 for Everkinetic. It is the same
     legal read, so asking once covers all three.
   - **USDA FoodData Central** — public domain, far better data quality for whole foods,
     much weaker for packaged and non-US products, needs a free API key.

   A hybrid (USDA for whole foods, Open Food Facts for barcodes) is plausible but doubles the
   normalisation surface. Recommendation is to start with one.

2. **Does food search need to work offline?** Phase 2 built `expo-sqlite` + FTS5 for the
   exercise catalogue precisely because offline workout execution needs it. Food logging has
   no equivalent hard requirement — but a food database is far larger than 870 exercises, so
   a full on-device sync is a different proposition. Decide deliberately rather than
   inheriting Phase 2's answer.

3. **Barcode scanning.** Not in the design and not in scope here, but it is the single
   feature that most determines which database is worth choosing. Worth a moment's thought at
   Phase A so the choice is not regretted later.

4. **The prototype's silent failures.** `saveGoals()` reverts invalid input without an error
   and `saveCustomFood()` returns silently on an empty name. Both are almost certainly
   prototype shortcuts rather than intended behaviour; decide the real error copy during
   Phase E rather than reproducing them.

## Related

- [ADR-020 — nutrition in MVP](../decisions/ADR-020-nutrition-in-mvp.md)
- [`../design/nutrition-screen-specs.md`](../design/nutrition-screen-specs.md) — the screens
- [`../design/design-revision-2026-08-30.md`](../design/design-revision-2026-08-30.md) — what changed and why
- [`phase-2-plan.md`](phase-2-plan.md) — the plan this one copies its shape and patterns from
