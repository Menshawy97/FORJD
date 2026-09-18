import { FoodCategory } from "@forjd/domain";

import { CsvTable, col } from "./csv";
import {
  CARBS_NUTRIENT_NAME,
  FAT_NUTRIENT_NAME,
  KCAL_NUTRIENT_PRECEDENCE,
  PROTEIN_NUTRIENT_NAME,
  SR_LEGACY_CATEGORY_NAMES,
  WWEIA_CATEGORY_IDS,
} from "./mappings";
import { NormalizedFoodWithType, UsdaDataType, UsdaFoodSourceAdapter } from "./usda-food-source-adapter.interface";

const SOURCE = "usda_fdc";

/**
 * One vendored USDA release (Foundation, SR Legacy, or Survey), already parsed into CSV tables
 * by `normalize.ts` -- this file does no I/O, mirroring `FreeExerciseDbAdapter`'s own pure
 * construction so the golden-fixture tests can hand-build small tables instead of reading real
 * files.
 *
 * `categoryScheme` picks which of the two category lookups (`mappings.ts`) resolves this
 * release's `food.food_category_id` -- Foundation and SR Legacy share the small SR-legacy-style
 * taxonomy (matched by category *name*, since `food_category.csv`'s own ids are release-local
 * integers with no cross-release meaning); Survey uses the WWEIA taxonomy (matched by id
 * directly, since `wweia_food_category.csv`'s ids are already the stable WWEIA codes).
 */
export interface UsdaReleaseInput {
  readonly food: CsvTable;
  readonly foodNutrient: CsvTable;
  readonly foodPortion: CsvTable;
  readonly nutrient: CsvTable;
  readonly measureUnit: CsvTable;
  readonly category: CsvTable;
  readonly categoryScheme: "sr_legacy" | "wweia";
  /** Which USDA data type this release is; stamped onto each food so curation can rank duplicates by source quality. */
  readonly dataType: UsdaDataType;
}

/**
 * Resolves both `nutrient.csv`'s `id` and its `nutrient_nbr` -> `name`, so `food_nutrient.csv`'s
 * `nutrient_id` can be read by name instead of by a hardcoded id.
 *
 * That column means different things per release (SOURCE.md's trap 1): Foundation and SR Legacy
 * carry `nutrient.id` values (Energy `1008`), Survey carries `nutrient.nbr` values (`208`) under the
 * same column name. Indexing by both is what makes Survey's macros resolve at all -- before this,
 * every Survey lookup missed and all 5,432 Survey foods normalized to 0 kcal/0 g. The two id
 * spaces do not collide for the four wanted nutrients or the three energy variants.
 */
function buildNutrientNameById(nutrient: CsvTable): Map<string, string> {
  const idCol = col(nutrient.header, "id");
  const nameCol = col(nutrient.header, "name");
  const nbrCol = nutrient.header.indexOf("nutrient_nbr");
  const map = new Map<string, string>();
  for (const row of nutrient.rows) {
    const name = row[nameCol] ?? "";
    map.set(row[idCol] ?? "", name);
    // "208" and "208.0" both occur across releases; a nutrient_nbr never has a real fraction.
    const nbr = nbrCol === -1 ? "" : (row[nbrCol] ?? "").replace(/.0$/, "");
    if (nbr) map.set(nbr, name);
  }
  return map;
}

function buildMeasureUnitNameById(measureUnit: CsvTable): Map<string, string> {
  const idCol = col(measureUnit.header, "id");
  const nameCol = col(measureUnit.header, "name");
  const map = new Map<string, string>();
  for (const row of measureUnit.rows) {
    map.set(row[idCol] ?? "", row[nameCol] ?? "");
  }
  return map;
}

/**
 * Resolves `food.food_category_id` -> `FoodCategory` for one release.
 *
 * **A category present in the lookup file but unmapped is skipped here, not thrown** --
 * `food_category.csv` and `wweia_food_category.csv` list every category USDA defines,
 * including ones this app's filtered dataset never actually uses (e.g. category id 26,
 * "Branded Food Products Database", which exists in the lookup because Foundation's own zip
 * ships it, even though `fetch-usda.ts` excludes Branded foods entirely per ADR-023). The real
 * enforcement is in `normalizeRelease`: a *food row* whose own category id resolves to nothing
 * here throws immediately, so "every lookup throws on a miss" still holds for every category a
 * real food actually references -- it just doesn't demand a mapping for categories that back no
 * food at all.
 */
export function resolveCategoryMap(
  category: CsvTable,
  scheme: "sr_legacy" | "wweia",
): Map<string, FoodCategory> {
  const map = new Map<string, FoodCategory>();

  if (scheme === "sr_legacy") {
    const idCol = col(category.header, "id");
    const nameCol = col(category.header, "description");
    for (const row of category.rows) {
      const id = row[idCol] ?? "";
      const name = row[nameCol] ?? "";
      const mapped = SR_LEGACY_CATEGORY_NAMES[name];
      if (mapped) map.set(id, mapped);
    }
    return map;
  }

  const idCol = col(category.header, "wweia_food_category");
  for (const row of category.rows) {
    const id = row[idCol] ?? "";
    const mapped = WWEIA_CATEGORY_IDS[id];
    if (mapped) map.set(id, mapped);
  }
  return map;
}

/**
 * Builds a food's serving label from `food_portion.csv`, resolving `measure_unit_id` against
 * `measure_unit.csv` (e.g. id `1001` -> `"tablespoon"`), falling back to the row's own
 * `portion_description` when the unit is `"undetermined"` (id `9999`, confirmed present in the
 * vendored data) -- the same "prefer the structured value, fall back to the free-text one" shape
 * USDA's own FDC website uses to label a portion. `amount` is the unit count (e.g. `2`
 * tablespoons); `gram_weight` is the serving's actual grams.
 */
function buildServingLabel(amount: string, unitName: string, modifier: string, portionDescription: string): string {
  if (unitName === "undetermined" || unitName === "") {
    return portionDescription || "serving";
  }
  // "1.0" -> "1", "0.5" stays "0.5" -- USDA's own `amount` is a plain decimal string.
  const qty = amount.replace(/\.0$/, "");
  const withModifier = modifier ? `${unitName}, ${modifier}` : unitName;
  return `${qty} ${withModifier}`;
}

/**
 * Normalizes all three vendored USDA data types into the canonical `Food` model (ADR-023).
 *
 * Pure by construction, mirroring `FreeExerciseDbAdapter`: every release's CSV tables are
 * constructor arguments, and the class does no I/O. `normalize.ts` reads the vendored files and
 * hands them here.
 */
export class UsdaFoodAdapter implements UsdaFoodSourceAdapter {
  readonly source = SOURCE;

  constructor(private readonly releases: readonly UsdaReleaseInput[]) {}

  normalizeAll(): NormalizedFoodWithType[] {
    const results: NormalizedFoodWithType[] = [];

    for (const release of this.releases) {
      results.push(...this.normalizeRelease(release));
    }

    return results;
  }

  private normalizeRelease(release: UsdaReleaseInput): NormalizedFoodWithType[] {
    const categoryById = resolveCategoryMap(release.category, release.categoryScheme);
    const nutrientNameById = buildNutrientNameById(release.nutrient);
    const measureUnitNameById = buildMeasureUnitNameById(release.measureUnit);

    const fdcIdCol = col(release.food.header, "fdc_id");
    const descriptionCol = col(release.food.header, "description");
    const foodCategoryIdCol = col(release.food.header, "food_category_id");

    const fnFdcCol = col(release.foodNutrient.header, "fdc_id");
    const fnNutrientCol = col(release.foodNutrient.header, "nutrient_id");
    const fnAmountCol = col(release.foodNutrient.header, "amount");

    const fpFdcCol = col(release.foodPortion.header, "fdc_id");
    const fpAmountCol = col(release.foodPortion.header, "amount");
    const fpMeasureUnitCol = col(release.foodPortion.header, "measure_unit_id");
    const fpPortionDescCol = col(release.foodPortion.header, "portion_description");
    const fpModifierCol = col(release.foodPortion.header, "modifier");
    const fpGramWeightCol = col(release.foodPortion.header, "gram_weight");

    const nutrientsByFdcId = new Map<string, Map<string, number>>();
    for (const row of release.foodNutrient.rows) {
      const fdcId = row[fnFdcCol] ?? "";
      const nutrientId = row[fnNutrientCol] ?? "";
      const name = nutrientNameById.get(nutrientId);
      // A nutrient id this release's own nutrient.csv doesn't list -- skip rather than throw,
      // since fetch-usda.ts already filtered food_nutrient.csv to only the wanted nutrients.
      if (!name) continue;
      const amount = Number(row[fnAmountCol] ?? "0");
      const byName = nutrientsByFdcId.get(fdcId) ?? new Map<string, number>();
      byName.set(name, amount);
      nutrientsByFdcId.set(fdcId, byName);
    }

    const portionsByFdcId = new Map<string, { label: string; grams: number }[]>();
    for (const row of release.foodPortion.rows) {
      const fdcId = row[fpFdcCol] ?? "";
      const unitName = measureUnitNameById.get(row[fpMeasureUnitCol] ?? "") ?? "";
      const label = buildServingLabel(
        row[fpAmountCol] ?? "1",
        unitName,
        row[fpModifierCol] ?? "",
        row[fpPortionDescCol] ?? "",
      );
      const grams = Number(row[fpGramWeightCol] ?? "0");
      const list = portionsByFdcId.get(fdcId) ?? [];
      list.push({ label, grams });
      portionsByFdcId.set(fdcId, list);
    }

    const foods: NormalizedFoodWithType[] = [];

    for (const row of release.food.rows) {
      const fdcId = row[fdcIdCol] ?? "";
      const categoryId = row[foodCategoryIdCol] ?? "";
      const category = categoryById.get(categoryId);
      if (!category) {
        throw new Error(`UsdaFoodAdapter: fdc_id ${fdcId} has unresolved category id "${categoryId}"`);
      }

      const macros = nutrientsByFdcId.get(fdcId) ?? new Map<string, number>();
      const kcalName = KCAL_NUTRIENT_PRECEDENCE.find((name) => macros.has(name));
      // No energy value reported at all (many Foundation lab entries): excluded rather than
      // shown as "0 kcal", which would claim a measurement USDA never made.
      if (!kcalName) continue;

      foods.push({
        source: this.source,
        sourceId: fdcId,
        name: row[descriptionCol] ?? "",
        category,
        macrosPer100g: {
          kcal: macros.get(kcalName) ?? 0,
          protein: macros.get(PROTEIN_NUTRIENT_NAME) ?? 0,
          carbs: macros.get(CARBS_NUTRIENT_NAME) ?? 0,
          fat: macros.get(FAT_NUTRIENT_NAME) ?? 0,
        },
        servings: portionsByFdcId.get(fdcId) ?? [],
        dataType: release.dataType,
      });
    }

    return foods;
  }
}
