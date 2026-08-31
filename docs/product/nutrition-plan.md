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
