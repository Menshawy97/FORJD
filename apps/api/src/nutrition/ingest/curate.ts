import { FoodNameExclusion, FOOD_NAME_EXCLUSIONS } from "./food-exclusions";
import { NormalizedFood, NormalizedFoodWithType, UsdaDataType } from "./usda-food-source-adapter.interface";

/**
 * Catalogue curation: the rules that decide which normalized USDA foods ship. Pure -- no I/O --
 * so every rule is unit-tested and `normalize.ts` is the only caller.
 *
 * Applied in this order, so each later rule only sees what earlier ones kept:
 *   1. **blocked** -- the name matches an entry in `FOOD_NAME_EXCLUSIONS`.
 *   2. **zero-calorie** -- 0 kcal per 100 g and not a beverage. Water, black coffee, tea and diet
 *      soda are real, loggable things that are legitimately 0 kcal, so `beverages` is exempt;
 *      salt, baking soda and stevia are not something a person logs as a meal.
 *   3. **duplicate** -- one food per normalized name. Runs last so a zero-kcal duplicate has
 *      already gone and can never be the one that survives.
 *
 * Foods with no energy value at all are already excluded by the adapter, not here.
 */

export type CuratableFood = NormalizedFoodWithType;

export interface RemovedFood {
  readonly sourceId: string;
  readonly name: string;
  readonly reason: string;
  /** For a duplicate, the `sourceId` of the food that was kept in its place. */
  readonly keptSourceId?: string;
}

export interface CurationResult {
  /** The foods that ship, in their input order, still carrying `dataType`. */
  readonly kept: CuratableFood[];
  readonly removed: RemovedFood[];
}

/** Lowercase, collapse whitespace, drop trailing punctuation -- so "Garlic, raw." and "garlic,  raw" are one food. */
export function normalizeFoodName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,.;:]+$/, "");
}

/** Better source first: hand-analysed Foundation, then the frozen SR Legacy reference, then Survey (a recipe-derived estimate). */
const DATA_TYPE_RANK: Record<UsdaDataType, number> = { foundation: 0, sr_legacy: 1, survey: 2 };

/** Ordering for choosing a duplicate group's survivor; a negative result means `a` is preferred. */
function compareForSurvival(a: CuratableFood, b: CuratableFood): number {
  // A food with servings is more useful to log than a gram-only one.
  const servings = Number(b.servings.length > 0) - Number(a.servings.length > 0);
  if (servings !== 0) return servings;
  const dataType = DATA_TYPE_RANK[a.dataType] - DATA_TYPE_RANK[b.dataType];
  if (dataType !== 0) return dataType;
  // Numeric where possible so the choice is stable across re-vendors, not string-ordered.
  return a.sourceId.localeCompare(b.sourceId, "en", { numeric: true });
}

export function curateCatalogue(
  foods: readonly CuratableFood[],
  exclusions: readonly FoodNameExclusion[] = FOOD_NAME_EXCLUSIONS,
): CurationResult {
  const removed: RemovedFood[] = [];
  const candidates: CuratableFood[] = [];

  for (const food of foods) {
    const blockedBy = exclusions.find((rule) => rule.pattern.test(food.name));
    if (blockedBy) {
      removed.push({ sourceId: food.sourceId, name: food.name, reason: `blocked: ${blockedBy.reason}` });
    } else if (food.macrosPer100g.kcal <= 0 && food.category !== "beverages") {
      removed.push({ sourceId: food.sourceId, name: food.name, reason: "zero-calorie" });
    } else {
      candidates.push(food);
    }
  }

  const groups = new Map<string, CuratableFood[]>();
  for (const food of candidates) {
    const key = normalizeFoodName(food.name);
    groups.set(key, [...(groups.get(key) ?? []), food]);
  }

  const survivors = new Set<CuratableFood>();
  for (const group of groups.values()) {
    const [survivor, ...losers] = [...group].sort(compareForSurvival);
    if (!survivor) continue;
    survivors.add(survivor);
    for (const loser of losers) {
      removed.push({
        sourceId: loser.sourceId,
        name: loser.name,
        reason: "duplicate",
        keptSourceId: survivor.sourceId,
      });
    }
  }

  return { kept: candidates.filter((food) => survivors.has(food)), removed };
}

/** Strips the curation-only `dataType`, leaving what the snapshot and loader use. */
export function toSnapshotFood(food: CuratableFood): NormalizedFood {
  return {
    source: food.source,
    sourceId: food.sourceId,
    name: food.name,
    category: food.category,
    macrosPer100g: food.macrosPer100g,
    servings: food.servings,
  };
}
