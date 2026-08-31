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

**Phase A — vendor the dataset.** ✅ ADR written ([ADR-023](../decisions/ADR-023-food-database-source.md)):
USDA FoodData Central, ingested and owned in our own table, not proxied live — matching the
`exercises` precedent (custom foods share the catalogue table, so the catalogue needs its own
stable internal IDs a food-log entry can reference safely). Scoped to the **Foundation, SR
Legacy, and Survey (FNDDS)** data types — together roughly 15k rows of generic/whole foods,
the exact coverage ADR-023 already prioritized — excluding **Branded** (~300k+ rows of
packaged products), the coverage gap ADR-023 already accepted.

Matching **exercises' own Phase A exactly** (`phase-2-plan.md`'s Phase A: "no schema, no
endpoints — nothing yet reads this file"), this phase is **vendoring only**. **Does not**
require `USDA_FDC_API_KEY` — bulk downloads are unauthenticated; the key stays reserved for a
possible future live-lookup outside the vendored subset. The source adapter, normalizer, and
load script that actually read this data are Phase D's work (mirroring exercises' own Phase D),
once the schema and repository from Phase C exist to upsert into — not this phase.

#### What the bulk release actually is — measured 2026-08-31, not assumed

The three pinned releases, all confirmed reachable and downloaded:

| Data type | Release / pin | Zip |
|---|---|---|
| Foundation | `FoodData_Central_foundation_food_csv_2025-04-24` | 3.3 MB |
| SR Legacy | `FoodData_Central_sr_legacy_food_csv_2018-04` | 5.8 MB |
| Survey (FNDDS) | `FoodData_Central_survey_food_csv_2024-10-31` | 3.2 MB |

**This is a full relational dump, not a food list** — 24 CSVs per release, most of them lab
provenance (`sub_sample_result.csv` alone is 4.7 MB). Only six tables matter to us: `food`,
`food_nutrient`, `nutrient`, `food_portion`, `measure_unit`, `food_category`.

**Real food counts, after excluding the sampling rows that share `food.csv`:**

| Data type | Rows in `food.csv` | Actual foods | Macro coverage | Has ≥1 portion |
|---|---|---|---|---|
| Foundation | 74,176 | **411** (`foundation_food`) | 353 energy / 399 protein | 116 (28%) |
| SR Legacy | 7,793 | **7,793** | 7,793 — complete | 7,533 (97%) |
| Survey (FNDDS) | 5,432 | **5,432** | 5,431 — complete | 5,395 (99%) |
| | | **13,636 total** | | |

Foundation's `food.csv` is 99% lab sampling records (`sub_sample_food` 62,022,
`market_acquisition` 7,215, `sample_food` 3,717, `agricultural_acquisition` 810). Filtering on
`data_type` is mandatory, not an optimisation — ingesting unfiltered would load 74k lab samples
as if they were foods.

#### Two traps found by inspecting the data, both of which would have shipped silently

1. **`food_nutrient.nutrient_id` means different things in different releases.** Foundation and
   SR Legacy use `nutrient.id` values (energy `1008`, protein `1003`, fat `1004`, carbs `1005`).
   **Survey uses `nutrient_nbr` values instead** (`208`, `203`, `204`, `205`) — the same column
   name, a different identifier series, while its own `nutrient.csv` still lists the `1008`-style
   ids. A single hardcoded id set measures Survey's macro coverage as **zero** and would ingest
   5,432 foods with null calories. The adapter must resolve nutrient ids **per release, through
   that release's own `nutrient.csv`**, keyed on both `id` and `nutrient_nbr`.
2. **Energy has three competing nutrient ids.** `1008` (Energy, KCAL) plus `2047`
   (Atwater General) and `2048` (Atwater Specific), which Foundation uses for some foods and
   not others. The adapter needs an explicit documented precedence rather than picking whichever
   row it encounters first.

#### Deliverables

- `apps/api/src/nutrition/ingest/data/` — the vendored subset. **Not the raw zips**: only the
  six needed CSVs, filtered to real foods, per release. Unlike free-exercise-db (whose upstream
  file was already lean enough to commit verbatim), committing these raw would put ~75 MB of
  lab-sampling CSV in git history permanently to use 13,636 rows of it. A `fetch-usda.ts`
  script performs the download-filter-write so the reduction is reproducible and reviewable,
  and the reduced files are what gets committed.
- `apps/api/src/nutrition/ingest/data/SOURCE.md` — the pin record, mirroring
  `exercises/ingest/data/SOURCE.md`: release names and dates, the download URLs, the licence
  statement **fetched at the pin rather than quoted from memory**, every measured number in
  the tables above, and the two traps recorded so a future re-vendor does not rediscover them.
- No schema, no endpoints, nothing reads the files yet.

#### Verification

`SOURCE.md`'s counts must be reproduced by a script, not typed by hand. CI runs the full API +
mobile suite (this touches `apps/api/src`, so `paths-ignore` does not apply). Checkpoint: PR,
CI green, merge, confirm CI green on `main`.

#### Open question for Phase C, raised here because the data forced it

Foundation foods have **28% portion coverage** — 295 of 411 have no serving other than "100 g".
SR Legacy and Survey are near-complete, so this only affects the smallest of the three sets, but
Phase C must decide whether a food with no named portion is still logged in grams only, or is
excluded from search. Recommendation: keep it, gram-only — the design's food detail screen has a
serving selector that can honestly offer only grams, and dropping 295 real foods to avoid an
empty dropdown is the worse trade.

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

## Open questions

1. ✅ **Which food database? Settled — [ADR-023](../decisions/ADR-023-food-database-source.md).**
   **USDA FoodData Central**, public domain, no share-alike obligation — the same clean legal
   footing free-exercise-db gave the exercise catalogue (ADR-005), and it adds nothing to the
   queue already waiting on legal engagement for wger and Everkinetic's share-alike licences.
   Open Food Facts (ODbL) and the hybrid option were both rejected for raising that same
   unresolved question a third time. Needs `USDA_FDC_API_KEY`, server-side only (rule 5).

2. ✅ **Does food search need to work offline? Settled — same ADR.** **Server-side only, no
   on-device sync.** Food logging has no equivalent to workout execution's hard offline
   requirement (CLAUDE.md rule 6), and FoodData Central's full dataset (300k+ rows) is a
   different proposition from the 870-exercise catalogue Phase 2 mirrored in full. Custom
   foods are still searched the same server-side way, alongside FoodData Central results.

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
