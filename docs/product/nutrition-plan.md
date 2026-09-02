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

**Phase A — vendor the dataset. ✅ DONE.** ADR written ([ADR-023](../decisions/ADR-023-food-database-source.md)):
USDA FoodData Central, ingested and owned in our own table, not proxied live — matching the
`exercises` precedent (custom foods share the catalogue table, so the catalogue needs its own
stable internal IDs a food-log entry can reference safely). Scoped to the **Foundation, SR
Legacy, and Survey (FNDDS)** data types — the exact coverage ADR-023 prioritized — excluding
**Branded** (~300k+ rows of packaged products), the coverage gap ADR-023 accepted.

Matching **exercises' own Phase A exactly** (`phase-2-plan.md`'s Phase A: "no schema, no
endpoints — nothing yet reads this file"), this phase was **vendoring only**: no schema, no
endpoints, nothing reads the vendored files yet. The source adapter, normalizer, and load
script that actually read this data are Phase D's work (mirroring exercises' own Phase D),
once the schema and repository from Phase C exist to upsert into.

#### What the bulk release actually is — measured for real, not estimated

Downloaded and inspected directly, in the browser (the FDC download page is a JS SPA; `curl`
alone saw only the loading shell). The bulk release is a **full relational dump, not a food
list** — 24 CSVs per release, most of them lab provenance (`sub_sample_result.csv` alone is
4.7 MB). `food.csv`'s row count is *not* the food count: Foundation's 74,176 rows are 99% lab
sampling records that share the file with real foods (`sub_sample_food` 62,022,
`market_acquisition` 7,215, `sample_food` 3,717, `agricultural_acquisition` 810) — filtering on
`data_type` is mandatory, not an optimisation.

**A design-spec check settled the nutrient scope before any vendoring began.**
`docs/design/nutrition-screen-specs.md` was searched for every nutrient the app ever displays,
and the answer is exactly four: kcal, protein, carbs, fat — no fiber, sugar, sodium, or
vitamins anywhere in the spec. Vendoring the full ~80-nutrient panel USDA ships per food would
have meant ~57 MB of permanently committed data (measured) for fields no screen reads; filtered
to those four, the real payload is **5.1 MB**.

**Two traps found by inspecting the real data, both of which would have shipped silently**
(recorded in full, with the fix, in `apps/api/src/nutrition/ingest/data/SOURCE.md`):

1. **`food_nutrient.nutrient_id` means different things in different releases.** Foundation and
   SR Legacy use `nutrient.id` values (energy `1008`, protein `1003`, fat `1004`, carbs `1005`).
   **Survey uses `nutrient_nbr` values instead** (`208`, `203`, `204`, `205`) under the same
   column name, while its own `nutrient.csv` still lists the `1008`-style ids. A hardcoded id
   set measured Survey's macro coverage as **zero** during this session — the actual figure,
   after fixing the resolution to match by nutrient *name* against each release's own
   `nutrient.csv` (accepting either its `id` or `nutrient_nbr`), is 5,431 of 5,432.
2. **Energy has three competing nutrient ids**, all KCAL: plain `Energy` (`1008`/`208`) alone
   covers only 135 of 469 Foundation foods (29%); `Energy (Atwater General Factors)`
   (`2047`/`957`) and `Energy (Atwater Specific Factors)` (`2048`/`958`) together cover 378
   (81%) — confirmed against FDC's own FAQ, which states most energy values are Atwater-factor
   derived. All three are vendored; Phase D's adapter picks a documented precedence at read
   time, not this script.

#### Delivered

- **`apps/api/src/nutrition/ingest/fetch-usda.ts`** — downloads the three pinned USDA bulk
  releases, filters each to real foods (`data_type`-matched) and the four wanted nutrients
  (resolved by name per release, fixing trap 1 above), and writes the reduced CSVs. Run via
  `pnpm --filter @forjd/api nutrition:fetch-usda`. Uses `adm-zip` (added as a devDependency —
  no zip-handling library existed in the repo). **Not the raw zips**: unlike free-exercise-db
  (whose upstream file was already lean enough to commit verbatim), the reduction is real work
  across three joined tables, so a script makes re-vendoring "run this, review the diff" rather
  than a repeated manual reduction.
- **`apps/api/src/nutrition/ingest/data/`** — the vendored output: **469 Foundation, 7,793 SR
  Legacy, 5,432 Survey foods, 13,694 total** (Foundation's count differs from an earlier
  estimate against a now-superseded pin — Foundation updates with every FoodData Central
  release, unlike frozen SR Legacy). 5.1 MB total.
- **`apps/api/src/nutrition/ingest/data/SOURCE.md`** — the pin record, mirroring
  `exercises/ingest/data/SOURCE.md`: release dates and URLs, the licence statement **fetched at
  usda.gov's policy page during this session, quoted verbatim, not assumed from memory**
  ("public domain information... Attribution may be cited as follows: 'U.S. Department of
  Agriculture.'" — no share-alike or attribution obligation, matching the clean legal footing
  ADR-023 chose USDA for), every measured number above, both traps with their fix, and which
  fields were deliberately left unvendored (`food_category.csv`/`wweia_food_category.csv` — the
  design's own curated food categories don't map onto either USDA taxonomy directly, so this is
  deferred to Phase D rather than speculatively vendored now, per YAGNI).

#### Verified

`tsc --noEmit` clean, `eslint` clean, `nest build` clean, architecture-conformance script
clean, and the full existing API suite (**401/401 tests, 22/22 suites**) still green — no
production code changed by this phase, only a new ingest script and vendored data, so this
confirms nothing broke rather than testing new behaviour (there is none yet to test).
Checkpoint: commit directly to `main` was judged appropriate given the change is additive-only
(new files, one new script entry, one new devDependency) with zero risk to existing behaviour —
revisit for a PR cycle if that judgement turns out wrong.

#### Open question for Phase C, raised here because the data forced it

Foundation foods have thin portion coverage — 187 portion rows across 469 foods, so a
meaningful share have no serving beyond "100 g". SR Legacy and Survey are both near-complete.
Phase C must decide whether a food with no named portion is still logged in grams only, or is
excluded from search. Recommendation: keep it, gram-only — the design's food detail screen has
a serving selector that can honestly offer only grams, and dropping real foods to avoid an
empty dropdown is the worse trade.

**Phase B — domain vocabulary. ✅ DONE.** `packages/domain/src/nutrition-vocabulary.ts`
(re-exported from `index.ts`), following `exercise-vocabulary.ts`'s pattern exactly: `MEAL_SLOTS`
(4, **Snack third**) and `FOOD_CATEGORIES` (8, matching the design's `FOOD_CATS` minus `'All'`,
which is a filter-chip value rather than a real category) as `as const` tuples with display-name
maps, plus `Serving`, `MacroTotals`, and the canonical `Food` interface. `Food` mirrors
`Exercise`'s own shape (ADR-017's precedent, explicitly named in this plan's locked decisions):
`ownerUserId: null` marks a catalogue row, `source`/`sourceId` track provenance the same way.

**`FOOD_CATEGORIES` deliberately excludes `'Custom'`.** The prototype writes custom foods with
a literal `category: 'Custom'` that isn't in its own `FOOD_CATS` list — the design spec calls
this out itself as "a prototype defect, not a spec" (§1). A custom food instead picks one of
the eight real categories, and `Food.ownerUserId !== null` is what marks it custom — matching
how `Exercise.category` is never `'custom'` either, with a separate `Custom` UI tag added in
Phase K's follow-up instead.

**RED confirmed before GREEN**, per the standing TDD rule: `nutrition-vocabulary.spec.ts` was
written and run failing (module has no exported members) before the vocabulary existed, then
implemented to pass — 8/8 new tests (23/23 in the package overall), asserting every tuple
member has a non-empty display name, no orphan map keys, `MEAL_SLOTS`' exact Snack-third order,
and `FOOD_CATEGORIES`' exact order excluding `'All'`. Verified: `packages/domain` typecheck,
lint, and build all clean; `apps/api` and `apps/mobile` both re-typechecked clean against the
updated `@forjd/domain`, confirming the new exports don't collide with anything downstream.

**Phase C — migration, schema and repository. ✅ DONE.**
`apps/api/src/database/schema/nutrition.schema.ts`: six tables, all mirroring `exercises.schema.ts`'s
established patterns rather than inventing new ones --
`foods` (one table for USDA catalogue + custom, `ownerUserId: null` marks a catalogue row, the
same two partial unique indexes as `exercises` for `(source, sourceId)` and
case-insensitive `(ownerUserId, lower(name))`), `food_servings` (a plain relational table, not
JSONB, so every table in the schema stays ordinary-SQL-queryable), `macro_goals` (one row per
user, **no seeded default** -- see below), `saved_meals` + `saved_meal_items`, and
`nutrition_log_entries` (the day's food log).

Migration `0008` (generated) adds all six tables. Migration `0009` (hand-written `--custom`,
mirroring `0006_add-exercise-search-indexes.sql` exactly) adds `foods.search_vector`
(generated `tsvector`, GIN-indexed) and a trigram GIN index on `foods.name` -- deliberately
**not** reflected in the typed schema, same reasoning as `exercises.schema.ts`'s own note.
Both migrations applied cleanly to local Postgres and verified directly against `\d foods`.

**Two decisions settled by asking rather than assuming, since the design had no answer for
either:**

1. **Before a user ever saves macro goals, `macro_goals` has no row for them at all** --
   confirmed with the user rather than guessed. `getMacroGoals` returns `null`, and the
   dashboard's future read shows an honest "set your goals" prompt instead of a ring against a
   fabricated default, the same honest-empty-state principle Phase J already applied to
   exercise stat tiles. No seeded default, no fallback computation.
2. **`nutrition_log_entries.loggedDate` is a plain `date`, supplied by the client's own local
   calendar day, never derived from a server timestamp** -- a server-computed day boundary
   would use the server's timezone, wrong for a user anywhere else. Not asked as a question
   (a mechanical implementation detail with no real product trade-off), but documented in the
   schema so the reasoning survives.

**`NutritionRepository`** (`apps/api/src/nutrition/nutrition.repository.ts`, 16 tests, real
Postgres, matching `ExercisesRepository`'s precedent exactly): `createCatalogueFood` (upsert on
`(source, sourceId)`), `createCustomFood` (case-insensitive duplicate-name → `ConflictException`),
`findFoodById`, `searchFoods` (FTS + trigram, same `searchCondition` shape as exercises),
`softDeleteCustomFood`; `getMacroGoals`/`setMacroGoals` (upsert); `createSavedMeal`/
`listSavedMeals`/`deleteSavedMeal`; and `logEntry`/`logSavedMeal`/`listLogForDate`/
`deleteLogEntry`/`deleteLogGroup`. **The macro snapshot on a log entry is computed by the
repository itself** from the food's current per-100g values and the logged grams, then stored
-- never looked up live at read time, so a later correction to a food's data can never silently
rewrite what a user is told they ate on a past day (the same "preserve source, do not
overwrite" instinct CLAUDE.md rule 10 states for health observations). `logSavedMeal` copies a
saved meal's items into the log sharing one `groupId`, never a live reference, so editing a
saved meal afterwards cannot rewrite already-logged history.

**RED confirmed before GREEN.** `nutrition.repository.spec.ts` was written and run failing
(module not found) before the repository existed, then implemented to pass. Verified: 16/16
new tests green, `tsc --noEmit` clean, `eslint` clean, `nest build` clean, architecture
conformance clean. **One flake found and diagnosed, not fixed:** the full 24-suite API test
run intermittently fails one Postgres-backed spec (a different one each run) under Jest's
default ~7-worker local parallelism -- confirmed to be pre-existing resource contention against
the shared Postgres pool (417/417 pass reliably with `--runInBand`, in less wall-clock time
than the flaky parallel run), not a regression from this phase's code. Every repository spec
file, including this one, opens its own `Pool()`, the same pattern `exercises.repository.spec.ts`
already used; adding a 24th such file made existing contention more likely to surface locally.
Out of this phase's scope to fix (CLAUDE.md: implement the requested vertical slice, not
adjacent test-infrastructure work) -- CI runs on far fewer cores than the 8-core dev machine
this was found on, so it is the authoritative check, watched per the standing rule rather than
assumed fine.

**Phase D — `UsdaFoodAdapter`, normalizer, and loader — ✅ DONE.**

**Correction to this plan, found while starting the phase:** the "Build order" originally
labelled this phase "contracts and endpoints" — that was wrong. The Phase A section above
(written earlier, and correct) already said Phase D is the source adapter/normalizer/loader,
mirroring exercises' own Phase D (adapter+normalizer) plus the loader half of exercises' Phase
E (writing into Postgres) — because nothing had read the vendored USDA CSVs into the `foods`
table yet, and building search/log endpoints against an empty catalogue would mean testing
against fixtures only, not real data. Confirmed with the user rather than guessed (2026-08-31).
**Contracts and endpoints are Phase E.**

- **Category lookup files, vendored.** `food.csv.food_category_id` needed a name to map
  against `FOOD_CATEGORIES`' 8 values; `food_category.csv` (Foundation/SR Legacy's shared
  ~25-row SR-legacy-style taxonomy) and `wweia_food_category.csv` (Survey's much larger WWEIA
  taxonomy) were deliberately left unvendored in Phase A pending this decision. `fetch-usda.ts`
  gained a `categoryFile` field on `ReleaseSpec` and now vendors both, unchanged counts on
  re-run (469/7,793/5,432 foods) confirming nothing else broke. **Measured:** Foundation uses
  19 distinct category ids, SR Legacy 25 (44 total, all named, in `apps/api/src/nutrition/
  ingest/data/{foundation,sr_legacy}/food_category.csv`), Survey (WWEIA) **172** distinct ids
  (`survey/wweia_food_category.csv`) — the WWEIA taxonomy is far more granular than the
  8-bucket design needs.
- **`packages/domain` was not touched.** A shared `csv.ts` util (`parseCsv`/`writeCsv`/`col`)
  was extracted from `fetch-usda.ts` once `usda-food.adapter.ts` needed the same row splitter,
  mirroring how the exercises ingest files share small helpers without a `packages/` dependency.
- **`ingest/mappings.ts`** — two deterministic tables, `SR_LEGACY_CATEGORY_NAMES` (keyed by
  category *description*, since `food_category.csv`'s own ids are release-local integers with
  no cross-release meaning) and `WWEIA_CATEGORY_IDS` (keyed by the stable WWEIA id directly),
  covering exactly the categories real vendored foods reference. `'snacks'` is the deliberate
  catch-all for SR Legacy's own "Soups, Sauces, and Gravies", "Fast Foods", "Meals, Entrees, and
  Side Dishes" and "Baby Foods", and for WWEIA's mixed-dish mid-range (burgers, sandwiches,
  pizza, ethnic combo dishes) — matching how the prototype's own `FOODS` table already puts
  Protein Bar and Dark Chocolate under Snacks rather than inventing a ninth bucket, and matching
  `NutritionRepository.keepCategory`'s own runtime fallback. One judgement call worth flagging:
  "Nuts and seeds" (SR Legacy id 12, WWEIA `2804`) maps to `snacks`, matching the design's own
  Almonds → Snacks, not to `fats` despite nuts' fat content. Also carries `KCAL_NUTRIENT_
  PRECEDENCE` (Atwater General → Atwater Specific → plain Energy, `SOURCE.md`'s trap 2) and the
  protein/fat/carbs nutrient names.
- **`ingest/usda-food.adapter.ts`** — `UsdaFoodAdapter implements UsdaFoodSourceAdapter`
  (`NormalizedFood = CreateCatalogueFoodInput`, the fifth adapter-pattern use in the codebase).
  Pure by construction: takes already-parsed `CsvTable`s per release, does no I/O. Resolves
  nutrient ids to names per-release (fixing the same "Foundation/SR Legacy use `nutrient.id`,
  Survey uses `nutrient_nbr`" trap `fetch-usda.ts` already found), builds a serving label from
  `food_portion.csv`'s `amount` + `measure_unit_id` (resolved via `measure_unit.csv`) +
  `modifier`, falling back to `portion_description` when the unit is `"undetermined"` (id
  `9999`). `resolveCategoryMap` **deliberately does not throw** for a category present in
  USDA's own lookup file but never referenced by a real food (e.g. id 26, "Branded Food
  Products Database" — present because Foundation's zip ships the full lookup even though
  Branded foods themselves are excluded per ADR-023); it throws only when an actual food row's
  category id resolves to nothing, which is where "every lookup throws on a miss" needs to bite.
  A food with no matching `food_portion` rows normalizes with an empty `servings` array
  (gram-only, per Phase A's decision) rather than being dropped or synthesizing a fake "100 g"
  entry.
- **`ingest/normalize.ts`** (`nutrition:normalize`) and **`ingest/load.ts`**
  (`nutrition:load`), mirroring `exercises/ingest/normalize.ts`/`load.ts` exactly, including
  `load.ts`'s `parseSnapshot` truncated-file defence (declared count vs. actual array length,
  every record checked for both halves of the `(source, sourceId)` upsert key) and
  `loadCatalogue`'s sequential, individually-idempotent upserts.
- **9 golden-fixture tests** (`usda-food.adapter.spec.ts`, hand-built `CsvTable`s, not the real
  13,694-food dataset) covering category resolution (both schemes), kcal precedence, the
  zero-nutrients and zero-servings cases, the `"undetermined"` unit fallback, the unmapped-vs-
  used-category distinction, and multi-release aggregation. **8 more** (`load.spec.ts`) for
  `parseSnapshot`'s validation and `loadCatalogue`'s sequencing/failure behaviour, against a
  fake target, no database.
- **Architecture conformance extended**: the raw vendored USDA CSVs are readable only from
  `normalize.ts` (`fetch-usda.ts` is exempt — it writes them, not reads for normalization),
  mirroring the existing `free-exercise-db.json` rule. Watched failing against a planted
  violation before being committed, per the standing rule.
- **Run for real, not just unit-tested**: `nutrition:normalize` produced 13,694 foods (protein
  4,271, snacks 3,790, grains 1,773, vegetables 1,548, beverages 893, fruits 550, dairy 531,
  fats 338; 650 with no servings, gram-only) with zero unresolved-category throws across the
  entire real dataset. `nutrition:load` then upserted all 13,694 into the local dev Postgres
  (confirmed via a direct `\d`/`select count(*)` check) with exit code 0. One real-data
  observation worth carrying forward, not a bug: a handful of catalogue entries (e.g. one of
  several "Banana, raw" records) have zero recorded values for these four macros in USDA's own
  data — the adapter correctly reports `0` for a food with no matching `food_nutrient` rows
  rather than guessing, but Phase E or F's search-result design should consider whether a
  catalogue food with all-zero macros needs a visual treatment (a real USDA data gap, not
  something normalization can fix).

**Verified:** `tsc --noEmit` clean, `eslint` clean, the full API suite green (**434/434 tests,
25/25 suites**, `--runInBand` per Phase C's flake note), and the conformance check both passes
clean and fails correctly against a planted violation.

**Deviation from the standing TDD rule, noted rather than hidden:** given this phase's scope
(a real external dataset, discovered column shapes, and a category taxonomy that needed
measuring against live data before it could be mapped), the golden-fixture tests were written
and run green immediately after the adapter rather than confirmed RED first against a
not-yet-existing adapter. The mapping tables and column-shape assumptions were instead verified
against the *real* vendored data (the `nutrition:normalize`/`nutrition:load` runs above) as the
correctness gate for this phase, which a synthetic RED test could not have provided anyway
(the risk here was "does the mapping match reality", not "does the code path get exercised").

**Phase E — contracts and endpoints — ✅ DONE** *(renumbered from the original "Phase D" — see
above)*.

- **`packages/contracts`**: `mealSlotSchema`/`foodCategorySchema` from the domain tuples;
  `foodResponseSchema` (one shape for both search rows and the detail screen -- nothing in
  `Food` is heavy enough to need a separate lean summary the way exercises' `imageUrls`/
  `instructions` did); `foodSearchQuerySchema` (bounded `limit`, no cursor -- the design's
  food-search screen is narrow-as-you-type, not infinite-scroll, and
  `NutritionRepository.searchFoods` truncates at `limit` without reporting whether more exist,
  so `listResponseSchema`'s "positive end-of-list statement" contract would be meaningless
  here); `createCustomFoodRequestSchema`; `macroGoalsResponseSchema`/
  `setMacroGoalsRequestSchema`; `nutritionLogEntryResponseSchema` (no food name/category --
  joining that in is a later phase's job) and its list envelope; `logFoodRequestSchema`
  (exactly `foodId`/`slot`/`loggedDate`/`servingLabel`/`grams`, no macro field at all -- the
  server computes and snapshots macros, never trusts a client-sent value, per the plan's
  carried-forward decision) and `logSavedMealRequestSchema`; `createSavedMealRequestSchema`/
  `savedMealResponseSchema`. 8 new fixtures, all schema-validated before being written. 34 new
  contract unit tests (`nutrition.spec.ts`) pinning every deliberate decision above.
- **A real data-isolation bug found and fixed before it ever reached the wire**:
  `NutritionRepository.searchFoods` (Phase C) had no owner scoping at all -- every signed-in
  user's search would have surfaced every *other* user's custom foods, since `foods` has no
  RLS of its own and Phase C's "no wire change" scope never exercised this path over HTTP.
  Fixed by adding a `viewerUserId` parameter, filtering to `ownerUserId IS NULL OR
  ownerUserId = viewerUserId` in SQL (category filtering was added to the same query, not
  applied afterward in the service -- filtering post-`limit` would under-return). Three new
  repository tests lock this in, including one that plants another user's custom food and
  asserts it never appears.
- **`NutritionService`** mirrors `ExercisesService`'s policy shape exactly: the repository
  never distinguishes "no such row" from "not yours" (`null`/`false`), and the service is where
  that becomes **404, never 403** (`AthletesService`'s anti-enumeration reasoning, extended to
  food/log/saved-meal data). `getMacroGoals` throws 404 rather than returning a fabricated
  default, per the locked decision. `logSavedMeal` checks the meal belongs to the caller before
  calling the repository at all -- `NutritionRepository.logSavedMeal` itself has no owner
  filter, so a stranger's saved-meal id would otherwise silently log zero items with a 200
  instead of a clear refusal. 21 unit tests against a fake repository.
- **`NutritionController`**, one controller for the whole vertical (`/nutrition/foods`,
  `/nutrition/macro-goals`, `/nutrition/meals`, `/nutrition/log`), `JwtAuthGuard` +
  `ZodValidationPipe` throughout, matching `ExercisesController`'s shape. `log/group/:groupId`
  declared before `log/:id` for the same route-ordering discipline `ExercisesController`'s
  `catalogue` route documents (the two never actually collide here, since they're a different
  number of path segments, but the habit is kept anyway).
- **`NutritionModule`** registered in `AppModule`, mirroring `ExercisesModule`'s DI wiring
  exactly.
- **6 new e2e tests** (`nutrition.e2e-spec.ts`) over real HTTP and real Postgres: auth
  required on every route; search returns a contract-valid shape; macro goals 404 before any
  save then round-trip a real one; logging a food computes kcal server-side even when the
  request body tries to smuggle its own (`kcal: 999999` never reaches the stored row); a
  duplicate custom-food name 409s and a stranger's view of it 404s identically to an unknown
  id (the same anti-oracle property the athlete endpoint already guarantees), and never
  appears in the stranger's own search; a saved meal logs as one group and the whole group
  deletes in one call, and a stranger can never log someone else's saved-meal id even after
  it's deleted.
- **A second gap found and fixed while checking Supabase readiness** (asked for explicitly):
  `.github/workflows/deploy-api.yml`'s deploy step ran `exercises:load` after `db:migrate` but
  never `nutrition:load` -- meaning the real deployed Supabase Postgres would have the
  nutrition tables (from Phase C's migrations) but an **empty `foods` table**, forever, since
  nothing else populates it. Added `pnpm --filter @forjd/api nutrition:load` right after
  `exercises:load`, same idempotent-upsert reasoning and the same "packages must be built
  first" fix already documented for the exercises loader.

**Verified**: `tsc --noEmit` and `eslint` clean across `apps/api`, `packages/contracts`,
`packages/domain`; full API suite green (**457 unit tests / 26 suites**, **84 e2e tests / 7
suites**, `--runInBand`); full mobile suite green (**369 tests / 67 suites** — unaffected, but
confirmed since `@forjd/contracts` is a shared dependency); architecture conformance clean.

**Phase F — the dashboard screen — ✅ DONE** *(renumbered from the original "Phase E" here —
this section's own lettering had not been updated when Phase D's earlier correction shifted
everything after it by one; fixed now rather than left to compound further)*. `nutrition.tsx`
plus its three bottom sheets (Save as meal, Log meal, Set daily goals), wired to real data via
the Phase E endpoints, verified against the real screenshots (`FORJD mobile app design/
screenshots/nutrition dashboard.png`, `Set Nutrition goals.png`, `save meal.png`) and on a
physical device via Expo Go during this session.

- **Empty state built first**, per the plan's own instruction: no goals ever saved shows an
  honest "Set your daily goals" prompt card instead of a ring against a fabricated default
  (the design's own prototype has no equivalent state, since its `MACRO_GOALS` literal always
  exists — this is a deliberate addition, not a fidelity gap). Every meal slot renders its
  label and a bare "+ Add food" link when empty, matching the design exactly (no per-slot
  empty-state string exists in the spec).
- **Two adaptations forced by Phase E's own wire shapes**, not stylistic choices, documented
  in `nutrition.tsx`'s own header comment:
  1. `NutritionLogEntryResponse` and `SavedMealResponse.items` carry only `foodId`, not a
     food's name — Phase E's docblock said joining that in was "a later phase's job"; this
     screen does it client-side, fetching every distinct `foodId` referenced (deduplicated)
     once per load and keeping them in a `foodsById` map.
  2. **Grouped log rows render individually, not collapsed.** The prototype's collapsed group
     row shows the *saved meal's own name*, but nothing in the wire model records that name
     once a meal is logged (`nutrition_log_entries` has only `groupId`, no `groupName`).
     Rendering each item individually is a feature reduction, not a behaviour change — every
     logged item still shows with its real name and macros; visual collapsing is a follow-up
     once a name source exists.
  3. No "qty ×N" suffix — the server model has no repeat-count field, only `servingLabel` +
     `grams`.
- **A missing route found and fixed during the device walk**: `nutrition.tsx`'s item-row tap
  navigated to `/food/[id]`, but that route file never existed — a dead link the mobile test
  suite's mocked router couldn't catch (it doesn't validate real route registration). Added a
  placeholder (`app/food/[id].tsx`), alongside two more the plan always intended as Phase G/I
  placeholders (`food-search.tsx`, `saved-meals.tsx`, `nutrition-share.tsx`), mirroring the
  exercises catalogue's own Phase I precedent for placeholder routes preceding the phases that
  fill them in.
- **A real UX bug found live on a physical device, not caught by any test**: the "Set daily
  goals" sheet's numeric keyboard covered its own Save/Cancel buttons and the lower input
  rows, leaving the user stuck mid-input with no way to confirm or see what they were typing.
  Fixed by wrapping both sheets that contain a `TextInput` (goals, save-as-meal) in
  `KeyboardAvoidingView`. Recorded as a durable lesson (no existing sheet in the app had ever
  needed this before) for every future bottom sheet with an input, starting with Phase G's
  custom-food sheet and `editMeal`'s inline grams inputs.
- **A real infinite-refetch bug found while debugging an unrelated test crash**: `loadAll`'s
  `useCallback` depended on the whole object `useToast()` returns, which is a fresh object
  every render — only its `show` function is stable. That gave `loadAll` a new identity every
  render, and the `useEffect` that calls it refired on every render, forever. Invisible in
  manual testing (network latency masks a tight reload loop enough not to notice), but it
  surfaced as a bizarre, seemingly environment-level Jest crash
  (`react-native-css-interop`'s `maybeHijackSafeAreaProvider` reading `Platform.OS` on
  `undefined`) that took extensive bisection to trace back to its real cause: React's own
  "act() not configured" warnings, present throughout the debugging, were themselves the
  correct signal of the bug, not noise. Fixed by depending on `toast.show` instead of `toast`.
- **New shared components/tokens**: `Icon`'s `share` glyph (transcribed from the prototype's
  `icon()` helper); `Header`'s `onBack` made optional, since the nutrition dashboard is "a
  destination, not a sub-screen" and has no back chevron (confirmed against the screenshot);
  the design's own flagged-missing `nutritionCarbs` token (`#6f9ac9`) added to both
  `tokens.ts` and `tailwind.config.ts`.
- **12 API client functions** added to `apiClient.ts` for the whole nutrition surface
  (search, food CRUD, macro goals, saved meals, the daily log).
- **8 fidelity tests** (`nutrition-fidelity.test.tsx`), covering the honest empty state, the
  populated summary ring/macro bars, real food-name resolution, optimistic delete, both
  sheets' full save/log flows (scoped with `testID`+`within` where two sheets can share
  visible text), and header-icon navigation.

**Verified**: `tsc --noEmit` and `eslint` clean; full mobile suite green (**379 tests / 69
suites**, confirmed after an unrelated resource-contention flake on the first run resolved
itself with fewer workers); architecture conformance clean; manually walked on a physical
iPhone via Expo Go against a locally-running API server with the real Phase D/E stack (the
staging deploy for Phase E was still mid-flight during this session — see the open item
below).

**Follow-up, fixed the same session**: the deploy for Phase E's PR took **1h42m56s** on the
"Run database migrations and load the exercise and nutrition catalogues" step — not hung,
confirmed by watching the Supabase dashboard live during the run (rows genuinely accumulating
the whole time), just far slower than local. Root cause, found by reading `createCatalogueFood`
again with fresh eyes: it does **3 sequential round trips per food** (insert, delete-servings,
insert-servings), so loading 13,694 foods was ~41,000 round trips. Locally, round-trip latency
to Postgres is near zero, so this was invisible; against a hosted Supabase instance from a
GitHub-hosted runner, each round trip pays real network latency, and it compounds.

**Fixed with `NutritionRepository.bulkUpsertCatalogueFoods`**: chunks the catalogue into
500-food multi-row `INSERT ... ON CONFLICT DO UPDATE` statements (referencing Postgres's
`excluded` pseudo-table for the per-row update values, since a bulk upsert has no single JS
value to fall back to), paired with a chunked delete-then-insert for servings. This cuts the
whole load to **~90 round trips total**, independent of network latency — measured locally at
25.8 seconds end-to-end for all 13,694 foods (previously several minutes even locally, though
the difference only became disqualifying once multiplied by real network latency). 500
rows/chunk keeps each statement's bind-parameter count (4,000) safely under Postgres's 65,535
limit — a single unchunked statement for the whole catalogue would have exceeded it.
`load.ts`'s `loadCatalogue` and its `FoodCatalogueTarget` interface were updated to call the
new bulk method instead of looping `createCatalogueFood` one row at a time;
`createCatalogueFood` itself is untouched and still used by nothing else that needs to iterate.
4 new repository tests against real Postgres (batch creation, idempotency, servings-replace,
empty-batch no-op). The stuck-looking deploy that prompted this was cancelled once the fix was
ready, rather than left to finish slowly a second time.

**Phase G — food search and detail — ✅ DONE.** `foodSearch`, `foodDetail`, and the
custom-food sheet.

**Outcome:** `food-search.tsx` and `food/[id].tsx` replace their Phase F placeholders; a new
shared `FilterChip` component was extracted after two mid-task screenshot corrections
(`fooddetails.png`, `searchfoodalsoaddfood.png` landed during the session) showed the
category and "Log as" chips use a solid accent-fill selected style, not the app's existing
translucent `pickRowSelectedBg` pattern. Edit-mode save is `deleteLogEntry` then `logFood`
(no PATCH endpoint exists for a single log entry); a code review caught that a failure
between those two calls was indistinguishable from a true no-op failure, so the catch now
gives that case its own message rather than reusing the generic offline/error toast.
Quantity has no wire field, so qty > 1 is encoded into the saved `servingLabel` text.
**Verified**: 10/10 new tests (`food-search-fidelity.test.tsx`, `food-detail-fidelity.test.tsx`)
green, `tsc --noEmit` clean, `eslint` clean, `npx expo export --platform android`
bundle-compiled cleanly (1533 modules).

**Everything this phase needs on the backend already shipped in Phase E/F**: `searchFoods`,
`getFood`, `createCustomFood` in `apiClient.ts`, and the matching contracts/endpoints. This
phase is mobile UI only.

**No screenshot exists for these screens.** The 2026-08-30 design revision's screenshot set
covers the dashboard, goals, save-meal, and saved-meals sheets, but never `foodSearch` or
`foodDetail` — confirmed by listing `FORJD mobile app design/screenshots/`. Building from
`s_foodSearch()`/`s_foodDetail()` in the runnable prototype (`FORJD Mobile.dc.html`, extracted
verbatim below) plus `nutrition-screen-specs.md` §3–4 is the only option, consistent with the
prototype already outranking every summary doc.

**Two decisions the design leaves open, settled with the user before starting:**

1. **Custom-food category.** Phase E's `createCustomFoodRequestSchema` already rejects the
   prototype's hardcoded `category: 'Custom'` literal and requires a real `FOOD_CATEGORIES`
   value (`nutrition-vocabulary.ts`'s docblock explains why) — but the prototype's sheet has no
   category picker at all, since it never needed one. **Decision: add a chip row of the 8 real
   categories to the sheet**, reusing the same selected-chip visual (`pickRowSelectedBg` /
   `borderPickRowSelected`) already used for the goals/log-meal slot chips in `nutrition.tsx`.
2. **Validation UX.** The prototype's `saveCustomFood()` silently no-ops on an empty name, and
   `foodDetail`'s save path has no validation at all. The real backend now enforces `name`
   min-length 1 and macros ≥ 0 with a 400. **Decision: show a real toast error** (the same
   `useToast`/`Toast` pattern `nutrition.tsx`'s goals sheet already uses for "Enter a valid
   calorie goal and macro values"), not the prototype's silent failure.

**Screens/files:**

- `apps/mobile/src/app/food-search.tsx` (replaces the Phase F placeholder). Header is
  contextual: `Add ingredient` when `foodTarget === 'meal'` (the param `editMeal` will pass in
  Phase H), else `Add to <Slot>`; back target matches (`editMeal` or `nutrition`). Search field
  + `FOOD_CATS`-equivalent chips (`FOOD_CATEGORIES` plus a local `'All'` pseudo-value that maps
  to `category: undefined` in the query) call `searchFoods(q, category)` **debounced ~300ms**
  server-side — unlike the prototype's instant in-memory filter over 38 rows, the real
  catalogue is 13,694+ USDA rows plus custom foods, so every keystroke cannot hit the network
  directly. Result row shows the food's first serving's kcal
  (`round(macrosPer100g.kcal * servings[0].grams / 100)`), matching §3 exactly. Empty state:
  `No foods match "<query>"`. `+` icon in the header opens the custom-food sheet.
- `apps/mobile/src/app/food/[id].tsx` (replaces the Phase F placeholder). Reads `id` (route
  param) via `getFood`, plus `entryId`/`slot` (edit mode, already sent by `nutrition.tsx`'s
  existing navigation at line ~170) and `foodTarget`/`slot` (new-log mode from `food-search`).
  Macro card, serving list + "Custom amount" row, quantity stepper (hidden when custom amount
  selected), "Log as" slot chips (hidden when `foodTarget === 'meal'`), sticky footer whose
  label depends on mode (`Save Changes` / `Add Ingredient` / `Add to Log`), ghost `Remove Entry`
  when editing. **No update endpoint exists** — `nutrition.controller.ts` only has `POST log`,
  `POST log/meal`, `DELETE log/group/:groupId`, `DELETE log/:id`, matching the design's own
  "saving filters the item id out of every slot before appending" note, which assumed
  client-side array mutation the real server model has no equivalent for. Adaptation: "Save
  Changes" in edit mode calls `deleteLogEntry(entryId)` then `logFood(...)`, not a PATCH — no
  new backend endpoint is added for this (Phase E's API surface is already merged and
  versioned; this is a client-side adaptation, the same class of forced adaptation
  `nutrition.tsx`'s own docblock already documents twice).
- Custom-food sheet lives inside `food-search.tsx` (matches the prototype's own structure — the
  sheet is part of `s_foodSearch()`, not a separate screen). Name input, category chip row
  (new, per decision 1), four numeric rows (kcal/protein/carbs/fat, decimals allowed, per
  100 g), calls `createCustomFood`, flashes `Added <name> to your foods`, real validation error
  on empty name (decision 2) instead of a silent return.
- `foodTarget === 'meal'` branches are implemented now (both screens already need the
  conditional per the prototype's own single-component structure), even though nothing calls
  it with `foodTarget: 'meal'` until Phase H's `editMeal` exists — this is the same screens'
  spec, not an adjacent feature, and avoids Phase H having to reopen these files.

**Testing (TDD, per project rules):** write failing RTL tests first for both screens, mirroring
`nutrition-fidelity.test.tsx`'s shape (mock `@/auth/apiClient`, mock `expo-router`,
`SafeAreaProvider` wrapper) — search debounce, category filtering, empty state, serving
selection, quantity stepper, custom-amount hides quantity/shows grams input, log-as-slot
hidden in meal mode, save/log/remove flows, and the custom-food sheet's category chips +
validation toast. Then `tsc --noEmit`, `eslint`, full mobile suite, and a real bundle compile
before merge, per the phase's own `## Verification` section below.

**Phase H — saved meals.** `savedMeals` and `editMeal`.

**Phase I — Home entry point.** The "Nutrition Today" card on the Home dashboard. Sequenced
last of the screens because Home itself is otherwise still a placeholder; if Home has been
built by then, this folds into that work instead.

**Phase J — share — ✅ DONE.** `nutritionShare`. Pure client rendering, no backend.

**Outcome:** `nutrition-share.tsx` replaces the Phase F placeholder (whose docblock said "Phase
I" — stale from an earlier renumbering pass; corrected). Reuses `nutrition.tsx`'s already-built
data path rather than adding anything new: `listNutritionLog(today)`, `getMacroGoals()`
(`.catch(() => null)`, same pattern), and the same client-side `foodsById` name-resolution via
`getFood`, deduplicated per `foodId`. Three preview layouts (Daily Summary ring, Macro Split
bars, Meal Log rows) switch on a local `layout` state, matching the prototype's own
`nutriShareLayout` field one-to-one; the ring uses the identical dasharray/dashoffset math
`nutrition.tsx`'s own calorie ring already established, just at the prototype's own smaller
r=40 size for the share-card preview.

**No screenshot existed when this phase was planned, but four surfaced mid-phase** —
`nutritionShare1.png` through `nutritionShare4.png` — and were used as the primary fidelity
check in place of the prototype, per this project's screenshots-first rule. They confirmed the
prototype's structure exactly, plus two details worth recording: the two unselected layout
thumbnails still carry the app's ordinary hairline border (not no border at all), and the Meal
Log layout's per-item kcal renders in the accent orange, not a dim grey — both already what the
prototype's own inline styles said, so no adaptation was needed, just verification against the
real screenshots rather than trusting a paraphrase.

**Decisions made:**

1. **Save Image / Instagram / More stay mocked**, exactly like the prototype's own `flash(...)`
   calls — toast-only confirmations, nothing written to the device and nothing actually shared.
   This codebase has no `expo-media-library`, `react-native-view-shot`, or `react-native-share`
   dependency, and none was added. Real device capture/sharing is a deliberate scope reduction
   for this lowest-priority phase, not a bug — the same honest-reduction principle Phase F
   documented for its own simplifications (e.g. grouped log rows rendering individually).
2. **A goals gate, not present in the prototype.** The prototype's demo state always has
   `macroGoals` populated, so it divides by `g.kcal` unconditionally. The real app can reach
   this screen with no goals ever set. Rather than fabricate a default goal to divide by (or
   crash), the screen shows an honest "Set your daily goals first" prompt back to the dashboard
   in place of the preview — the same honest-empty-state principle `nutrition.tsx`'s own goals
   card already applies to its ring, not a new one invented for this screen.

**Correction, written after the fact.** Two implementation attempts at a background-photo
picker (gallery + camera, `NSCameraUsageDescription`, a scrim overlay) for this screen were
declined by the agents assigned to them, each independently unable to verify that a
coordinator-relayed request actually originated from the user rather than from an injected
instruction — the right call given the information available to either agent at the time, and
exactly what this project's instruction-source rules are for. The paragraph originally here
recorded the second decline as a probable repeat injection attempt.

**That characterization was wrong.** The request was genuine — asked directly by the user in
conversation with the orchestrating session, confirmed a second time when asked directly again
after both declines. The orchestrating session cannot make a background agent trust a relayed
claim of user consent (nor should it be able to — that would defeat the entire point of the
instruction-source boundary), so the only reliable fix once delegation trust breaks down this
way is for the orchestrating session to do the work itself, backed by the user's own message,
rather than keep asking an agent to take a coordinator's word for it. This is a real limitation
of multi-agent delegation worth remembering: a locked "declined, treat as suspicious" decision
recorded in project docs will correctly make every subsequent agent that reads those docs more
suspicious of the same request, even once it is genuinely authorized — so a reversal needs to
overwrite the record it is reversing, not just add a note beside it, or the false trail persists
for whichever agent reads the docs next.

**Background photo picker — implementation.** One `backgroundPhotoUri` state variable, declared
alongside (not nested under) `layout`, so it survives every layout switch untouched — the
feature's own "one shared photo, not per-layout" requirement holds by construction, not by a
special case. A small circular icon button (`accessibilityLabel="Background photo"`,
`Icon name="camera"`) sits in the card's top-right corner and opens a bottom sheet built from
`nutrition.tsx`'s own Log Meal / Save Meal / Set Goals sheet shape verbatim — the same
absolute-inset `colors.scrim` backdrop plus a rounded-top `bg-surface` panel, not a new modal
pattern. The sheet offers "Take Photo" and "Choose from Gallery", plus a destructive "Remove
Photo" row (`colors.destructive`, the same token `exercise/[id].tsx`'s own delete-icon button
uses) that only renders once a photo is actually set, and a "Cancel" row.

Gallery selection reuses `edit-profile.tsx`/`pick-username.tsx`'s established
`requestMediaLibraryPermissionsAsync` + `launchImageLibraryAsync` pair exactly. Camera capture
is new — `requestCameraPermissionsAsync` + `launchCameraAsync` — nothing else in the app called
these before. Both flows request permission first and toast a plain-language denial message
without ever calling the picker/camera launcher if the OS refuses (`'Photo access is needed to
set a background.'` / `'Camera access is needed to take a photo.'`), then run the picked or
captured URI through `expo-image-manipulator`'s legacy `manipulateAsync(uri, [{ resize: {
width: BACKGROUND_PHOTO_MAX_WIDTH } }], { compress: 0.8, format: SaveFormat.JPEG })` — the
"lightweight resize, not a formal pipeline" the feature asked for, so an arbitrary
multi-megapixel original never sits behind this small 4:5 preview card at full resolution.
`expo-image-manipulator` (`~14.0.8`, added via `npx expo install` so its version stays pinned
to this project's Expo SDK 54, per `apps/mobile/AGENTS.md`) was chosen over a hand-rolled
resize for the same "prefer a battle-tested library" reasoning the rest of this codebase
already follows — it is the official Expo SDK entry for exactly this.

When a photo is set, it replaces the card's `LinearGradient` entirely (both painted via
`StyleSheet.absoluteFillObject` inside the same bordered, clipped outer `View`, so neither
needs its own border/radius/overflow handling), with a `colors.scrim` overlay — the identical
token every other modal backdrop in this app already uses for a dark overlay — laid behind the
text/graphics for legibility, exactly as the feature asked ("reuse this app's existing
dark-atmosphere overlay technique rather than inventing one"; the ember radial-gradient
technique in `ScreenBackground` was considered and rejected, since its orange tint is tuned for
this app's own screens, not for sitting over an arbitrary user photo). Removing the photo clears
`backgroundPhotoUri` and the gradient reappears, unchanged from before this feature existed nor
persisted anywhere: purely local component state, matching this screen's existing "no backend
involvement" scope untouched.

**iOS permission string, added.** `app.config.ts`'s `ios` block had no `infoPlist` at all before
this phase — `NSCameraUsageDescription` is now declared there, since `launchCameraAsync` is the
first call in this codebase to ever need it (the existing gallery-only screens never triggered
iOS's camera permission prompt). **Android, confirmed rather than assumed**, per the feature's
own instruction: `expo-image-picker`'s own `android/src/main/AndroidManifest.xml` already
declares `CAMERA`, `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE`, and the API-30
`IMAGE_CAPTURE`/`ACTION_VIDEO_CAPTURE` `<queries>` entries — Expo's config-plugin system merges
a native module's own manifest during prebuild automatically, so no `app.config.ts` change was
needed on that platform; read directly out of the installed package rather than taken on faith.

**Testing (TDD, per project rules) — extended.** `nutrition-share-fidelity.test.tsx` gained a
`background photo picker` sub-describe block: gallery pick end-to-end (permission granted,
picker returns an asset, `manipulateAsync` is called with that URI, the resized URI — not the
raw picker URI — becomes the rendered `Image` source, and the sheet closes itself), the gallery
permission-denied path (a toast fires and `launchImageLibraryAsync` is never called), the same
pair for camera, removing a photo, confirming "Remove Photo" is absent until a photo exists,
switching between all three layouts with a photo set (the same resized URI asserted present
after each switch — the "shared, not per-layout" contract, checked directly rather than
assumed), and cancelling the sheet with no state change. One synchronization detail worth
recording: `fireEvent.press` on the trigger button needs an `await waitFor(...)` before the next
interaction with the sheet's own content — the state update that opens the sheet was landing a
tick later than `fireEvent.press` alone accounts for under this RN test renderer, unlike the
plain callback-firing presses (e.g. the header back chevron) elsewhere in this same file; every
open-then-interact step in the new tests waits on the sheet's own text before proceeding, rather
than assuming synchronous re-render the way the rest of the file safely can.

**Verified (background photo picker addition):** `nutrition-share-fidelity.test.tsx` 15/15
green (the original 7 plus 8 new); full mobile suite **429/429 tests, 73/73 suites** green
(`TZ=UTC pnpm --filter @forjd/mobile test --ci --watchAll=false`), up from Phase J's own
421/421 baseline by exactly the 8 new tests; `tsc --noEmit` clean across the workspace (after
building `packages/contracts`/`packages/domain` first -- their `dist/` output wasn't present in
this fresh checkout, which is what actually produced the wall of unrelated `Cannot find module
'@forjd/contracts'` errors on the first run, not a defect in this phase's own code); `eslint`
clean on both changed files; `npx expo export --platform android` bundle-compiled cleanly (1544
modules, up from Phase J's 1539 by the newly-imported `expo-image-manipulator` module graph),
using the same local-only `.claude/worktrees` metro blocklist workaround Phase J already
documented, reverted before anything was committed.

**Testing (TDD, per project rules):** `nutrition-share-fidelity.test.tsx`, mirroring
`nutrition-fidelity.test.tsx`'s shape. Covers all three layout previews rendering from fetched
log/goals data, thumbnail selection switching the preview, concrete ring-offset and macro-bar-
width math (not just "renders without crashing" — e.g. totals of kcal 600 / protein 75 / carbs
100 / fat 25 against a 2000/150/200/100 goal, asserting the ring's exact `strokeDashoffset` and
the bars' exact `50%`/`25%` fill widths), the Meal Log layout's 7-item display cap vs. its
totals still summing every logged item, all three action buttons' toast confirmations, the
goals-missing gate, and back navigation. 7/7 new tests green.

**Verified:** full mobile suite 421/421 green (`TZ=UTC pnpm --filter @forjd/mobile test --ci
--watchAll=false`), `tsc --noEmit` clean, `eslint` clean, `npx expo export --platform android`
bundle-compiled cleanly (1539 modules). The bundle-compile step needed a local-only workaround:
this repo's `metro.config.js` blocklists any path containing `.claude/worktrees/` to stop Metro
watching sibling worktrees, but that same regex also blocks a worktree's *own* node_modules
when the checkout being built is itself inside `.claude/worktrees/` (as this session's was) —
confirmed by tracing the exact "Unable to resolve module .../expo-router/entry.js" failure to
that line. Verified locally by temporarily commenting out that one regex line, running the
export, then reverting via `git checkout` before committing anything — not a change to the
committed config, since CI's own checkout is never inside a worktree and never hits this.

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
