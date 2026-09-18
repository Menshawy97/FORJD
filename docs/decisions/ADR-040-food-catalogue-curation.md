# ADR-040: Food catalogue curation — fix, filter, deduplicate, prune

**Status:** Accepted
**Date:** 2026-09-18

## Context

The food search showed foods with 0 kcal, the same food several times with different calories,
and US restaurant chains that do not exist in Egypt. Measured against the committed snapshot
(13,694 foods):

- **5,432 zero-calorie foods were a bug, not data.** Every Survey (FNDDS) food had 0 kcal / 0 g
  macros. Survey's `food_nutrient.csv` carries `nutrient_nbr` values (`208`) under the
  `nutrient_id` column, while Foundation and SR Legacy carry `nutrient.id` values (`1008`).
  `fetch-usda.ts` handled this (SOURCE.md, trap 1) but the adapter only indexed `nutrient.id`, so
  every Survey lookup missed and defaulted to 0.
- **92 foods report no energy value at all** (Foundation lab entries: oils, butter, dry beans),
  and 8 more are genuinely 0 kcal but not something anyone logs (salt, baking soda, stevia).
- **239 exact-name duplicates** across the three data types (e.g. `Strawberries, raw` ×6, each
  with a different kcal). This is the "two calorie entries" that users noticed.
- **~280 foods from US chains and institutions** with no Egyptian presence or relevance.
- `nutrition:load` only ever upserted, so removing a food from the snapshot left its row in the
  database forever.

## Decision

The rules live in code and re-apply on every normalize and every deploy — nothing is a one-off
edit to the data.

1. **Fix the adapter.** `buildNutrientNameById` indexes both `id` and `nutrient_nbr`. A food
   with **no energy value** is excluded by the adapter instead of being shown as 0 kcal.
2. **Curate at normalize time** (`ingest/curate.ts`, pure, unit-tested), in this order:
   - **blocked** — the name matches `FOOD_NAME_EXCLUSIONS` (`ingest/food-exclusions.ts`);
   - **zero-calorie** — 0 kcal and not in the `beverages` category. Water, black coffee, tea and
     diet soda stay because people do log them;
   - **duplicate** — one food per normalized name. Survivor: a food with servings, then
     Foundation > SR Legacy > Survey, then lowest `sourceId`. Runs last so a zero-kcal duplicate
     can never survive.
3. **Audit trail.** `data/removed-foods.json` lists every removed food and why, and is committed.
   CI regenerates both files and fails on any diff (`ci.yml`), so a rule edit that was not
   regenerated, or a hand-edited snapshot, cannot merge.
4. **Prune on load** (`NutritionRepository.pruneCatalogueFoods`, run by `nutrition:load` on every
   deploy). Catalogue rows absent from the snapshot are deleted, or soft-deleted when a log
   entry or saved meal references them (`nutrition_log_entries.food_id` is `ON DELETE RESTRICT`
   and `saved_meal_items` cascades). Custom foods are never touched, and the prune refuses to run
   if it would remove more than 20% of the catalogue.

## Removing more foods later (the recurring workflow)

Add an entry to `FOOD_NAME_EXCLUSIONS`, run `pnpm --filter @forjd/api nutrition:normalize`,
review the `removed-foods.json` diff, merge. The next deploy removes those rows. Deleting an
entry restores the foods on the next load. A rule that matches nothing fails `curate.spec.ts`.

## Consequences

- Past log entries keep their snapshotted macros (schema docblock on `nutrition_log_entries`).
  Anything already logged from a zero-macro Survey food stays at 0 for that day; new logs are right.
- The chain list is a product decision, not a fact: McDonald's, KFC, Burger King, Pizza Hut,
  Subway, Domino's, TGI Fridays, Wendy's and Papa John's were kept as present in Egypt.
- Survey foods replaced some Foundation/SR Legacy survivors in duplicate groups because they
  carry servings; this favours loggability over lab-grade precision and is the tie-break to
  revisit if that trade-off proves wrong.
