import { CreateCatalogueFoodInput } from "../nutrition.repository";

/**
 * The fifth use of the adapter pattern in this codebase (`AuthProvider`, `StorageProvider`,
 * `HealthProvider`, `ExerciseSourceAdapter`): USDA FoodData Central is normalized into the
 * canonical model behind an interface, mirroring `ExerciseSourceAdapter` exactly.
 *
 * A normalized record is exactly `CreateCatalogueFoodInput` rather than a parallel type -- one
 * shape, so the loader has nothing to translate and the two cannot drift.
 */
export type NormalizedFood = CreateCatalogueFoodInput;

export type UsdaDataType = "foundation" | "sr_legacy" | "survey";

/**
 * A normalized food plus the USDA data type it came from. The data type exists only so curation
 * (`curate.ts`) can rank duplicates; `normalize.ts` strips it before writing the snapshot, so
 * the committed snapshot and the loader still see plain `NormalizedFood`.
 */
export type NormalizedFoodWithType = NormalizedFood & { readonly dataType: UsdaDataType };

export interface UsdaFoodSourceAdapter {
  /** Stamped onto every record's `source`, and half of the `(source, sourceId)` upsert key. */
  readonly source: string;

  /**
   * Normalizes the whole vendored dataset (all three data types) in one pass. Whole-dataset
   * rather than per-record for the same reason as `ExerciseSourceAdapter.normalizeAll` -- a
   * category or nutrient id that resolves against nothing in that release's own lookup table is
   * only detectable by looking, and throws rather than silently defaulting.
   */
  normalizeAll(): NormalizedFoodWithType[];
}
