# Source: USDA FoodData Central

Three of USDA's five FoodData Central data types, per ADR-023: **Foundation**, **SR Legacy**,
and **Survey (FNDDS)**. Excludes **Branded** (~300k+ rows of packaged products, ADR-023's
accepted coverage gap) and **Experimental** (research-only foods, not relevant here).

**Filtered, not vendored verbatim.** Each release is a full relational dump — 24 CSVs, most of
it lab-sampling provenance never read by this app. `fetch-usda.ts` downloads the pinned zips,
filters to real foods and the four nutrients the design displays, and writes the reduced
result here. Re-run it (`pnpm --filter @forjd/api nutrition:fetch-usda`) to re-vendor against a
newer release; everything below is what that run produced.

## Pins

Fetched 2026-08-31 from `fdc.nal.usda.gov/fdc-datasets/`:

| Data type | Release | Zip URL |
|---|---|---|
| Foundation | 2026-04-30 | `FoodData_Central_foundation_food_csv_2026-04-30.zip` |
| SR Legacy | 2018-04 (final release — SR Legacy will not be updated again) | `FoodData_Central_sr_legacy_food_csv_2018-04.zip` |
| Survey (FNDDS) | 2024-10-31 (FNDDS 2021-2023 cycle) | `FoodData_Central_survey_food_csv_2024-10-31.zip` |

**Re-vendoring:** update the three URLs and `dataType` values in `fetch-usda.ts`'s `RELEASES`
constant to the new pin, re-run, update this table. Nothing else in the pipeline needs to
change — the script is release-agnostic (see the two traps below for why).

## Measured numbers (this pin)

`food.csv`'s row count is **not** the food count — most rows in Foundation's `food.csv`
(74,176) are lab-sampling metadata that shares the same file, not foods. Real food count is
the `data_type`-filtered figure below.

| Data type | Real foods | `food_nutrient` rows kept | `food_portion` rows kept | Vendored size |
|---|---|---|---|---|
| Foundation | 469 | 2,009 | 187 | 136 KB |
| SR Legacy | 7,793 | 31,172 | 14,449 | 2.4 MB |
| Survey (FNDDS) | 5,432 | 21,724 | 22,046 | 2.6 MB |
| **Total** | **13,694** | 54,905 | 36,682 | **5.1 MB** |

(Foundation's 469 differs from the 411 measured against the *previous* 2025-04-24 pin, recorded
in an earlier draft of this document and in `docs/product/nutrition-plan.md`'s Phase A section —
Foundation is updated with each FoodData Central release, unlike SR Legacy, which is frozen.)

Foundation's portion coverage is thin — 187 rows across 469 foods, so a meaningful share have
no serving beyond "100 g" (`nutrition-plan.md`'s Phase A section flags this for Phase C: keep
them gram-only rather than excluding them). SR Legacy and Survey are both near-complete on
portions.

## License — verified at fdc.nal.usda.gov and usda.gov, not assumed

FoodData Central itself (Help/FAQ/Download pages) states no data-specific licence. Its parent
domain does, at **usda.gov/policies-and-links**, fetched 2026-08-31, verbatim:

> **Digital Rights and Copyright**
>
> Most information presented on the USDA Web site is considered public domain information.
> Public domain information may be freely distributed or copied, but use of appropriate
> byline/photo/image credits is requested. Attribution may be cited as follows: "U.S.
> Department of Agriculture."

This matches the general rule for works of the U.S. federal government (17 U.S.C. § 105: no
copyright protection for works prepared by federal employees as part of their official duties)
and is the basis for ADR-023's choice — no share-alike or attribution *obligation*, unlike
Open Food Facts' ODbL. Attribution ("U.S. Department of Agriculture") is requested, not
required; worth carrying onto an about/licences screen if one exists by the time this ships,
the same "not legally required, still good practice" note ADR-018 made for free-exercise-db.

## Two traps found by inspecting the data, both of which would have shipped silently

Full detail in `docs/product/nutrition-plan.md`'s Phase A section; recorded again here because
this is the file a re-vendor will actually be read against.

1. **`food_nutrient.nutrient_id` means different things in different releases.** Foundation and
   SR Legacy's `food_nutrient.csv` carries `nutrient.id` values (Energy `1008`, Protein `1003`,
   Fat `1004`, Carbs `1005`). **Survey's carries `nutrient.nbr` values instead** (`208`, `203`,
   `204`, `205`) under the identical column name, while Survey's own `nutrient.csv` still lists
   the `1008`-style ids. `fetch-usda.ts`'s `resolveWantedNutrientIds` fixes this by resolving
   the wanted nutrient **names** against each release's own `nutrient.csv` and accepting either
   its `id` or its `nutrient_nbr` as a match — measured correct against this pin (Survey:
   21,724 rows kept, not zero).
2. **Energy has three competing nutrient ids**, all in KCAL: plain `Energy` (`1008`/`208`),
   `Energy (Atwater General Factors)` (`2047`/`957`), and `Energy (Atwater Specific Factors)`
   (`2048`/`958`). Measured against this pin, on Foundation: plain `Energy` alone covers only
   135 of 469 foods (29%); the two Atwater variants together cover 378 (81%) — confirmed
   against FDC's own FAQ, which states most energy values are Atwater-factor-derived and a
   food profile shows whichever is available. All three are kept; **the adapter (Phase D)
   picks a documented precedence between them at read time**, not this script.

## Fields vendored vs. deliberately left out

- **Vendored, unfiltered per release:** `nutrient.csv` (477 rows, tiny, needed to resolve trap
  1 above) and `measure_unit.csv` (122 rows, tiny, needed to interpret `food_portion`'s
  `measure_unit_id`).
- **Vendored, filtered to real foods:** `food.csv` (all columns kept — `fdc_id`, `data_type`,
  `description`, `food_category_id`, `publication_date`), `food_portion.csv` (all columns).
- **Vendored, filtered to real foods AND the four wanted nutrients:** `food_nutrient.csv`,
  reduced to three columns (`fdc_id`, `nutrient_id`, `amount`) — the source's `data_points`,
  `derivation_id`, `min`, `max`, `median`, `footnote`, `min_year_acquired` columns are lab
  metadata this app never reads.
- **Vendored in Phase D:** `food_category.csv` (Foundation/SR Legacy's shared ~25-row
  SR-legacy-style taxonomy) and `wweia_food_category.csv` (Survey's larger WWEIA taxonomy, 172
  distinct ids actually referenced by the vendored foods, measured 2026-08-31). Left unvendored
  in Phase A per YAGNI, since the design's 8 `FOOD_CATS` are a curated set that maps onto
  neither USDA taxonomy directly and the mapping tables (`ingest/mappings.ts`) turned out to be
  real, deliberate product judgement rather than a mechanical lookup — worth doing once Phase D
  actually needed it, not speculatively in Phase A.
- **Never vendored, by design:** every other nutrient (fiber, sugar, sodium, vitamins,
  minerals — USDA ships ~80 per food). ADR-023 and this session's design-spec review confirmed
  no nutrition screen displays anything beyond kcal/protein/carbs/fat.
