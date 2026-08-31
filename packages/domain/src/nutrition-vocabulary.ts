/**
 * Canonical nutrition vocabulary (Phase 2.5, ADR-023). Same `as const` tuple + display-name
 * map pattern as `exercise-vocabulary.ts` -- `@forjd/contracts` builds `z.enum(...)` from the
 * tuples, and the UI never hardcodes a label.
 *
 * `MEAL_SLOTS` and `FOOD_CATEGORIES` back `text` columns, never Postgres enums, for the same
 * reason every other closed set in this package does: narrowing a tuple is free, narrowing a
 * PG enum is impossible.
 */

/**
 * Fixed four, matching the prototype's `SLOTS` exactly
 * (`docs/design/nutrition-screen-specs.md` §1). **Order matters** -- Snack sits third, between
 * Lunch and Dinner, not last -- both because the design's own meal sections render in this
 * order and because `nutrition-plan.md`'s locked-decisions table fixes it explicitly.
 */
export const MEAL_SLOTS = ["breakfast", "lunch", "snack", "dinner"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_DISPLAY_NAMES: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  dinner: "Dinner",
};

/**
 * The design's `FOOD_CATS` (`docs/design/nutrition-screen-specs.md` §1), minus `'All'` --
 * that value is the food-search screen's own "show every category" filter-chip state, not a
 * category a food actually belongs to, the same distinction `library.tsx`'s `'All'` filter
 * chip already draws without being an `ExerciseCategory` member.
 *
 * **Deliberately excludes `'Custom'`.** The prototype writes custom foods with a literal
 * `category: 'Custom'` string that isn't in its own `FOOD_CATS` list, making custom foods
 * reachable only under `'All'` -- the design spec itself calls this out as "a prototype
 * defect, not a spec" (§1). Custom-ness is instead tracked the way `Exercise.ownerUserId`
 * already tracks it: a custom food still picks one of these eight real categories, and
 * `Food.ownerUserId !== null` is what marks it as custom.
 */
export const FOOD_CATEGORIES = [
  "protein",
  "grains",
  "fruits",
  "vegetables",
  "dairy",
  "snacks",
  "fats",
  "beverages",
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

export const FOOD_CATEGORY_DISPLAY_NAMES: Record<FoodCategory, string> = {
  protein: "Protein",
  grains: "Grains",
  fruits: "Fruits",
  vegetables: "Vegetables",
  dairy: "Dairy",
  snacks: "Snacks",
  fats: "Fats",
  beverages: "Beverages",
};

/**
 * A named serving a food can be logged in, e.g. `{ label: "1 medium (118g)", grams: 118 }` --
 * the design's own `[servingLabel, grams]` pair shape (§1), given field names. A food's
 * per-100g macros are multiplied by `grams / 100` to get a serving's actual values; nothing
 * about a serving is stored pre-multiplied, so editing grams (the `editMeal` screen's inline
 * grams input, §8) only ever needs this one multiplication, never a second lookup.
 */
export interface Serving {
  label: string;
  grams: number;
}

/**
 * The four values every nutrition screen displays and nothing more (ADR-023: the design was
 * searched for every nutrient reference and found exactly these four -- no fiber, sugar,
 * sodium, or vitamins anywhere in `nutrition-screen-specs.md`). Reused for both a day's macro
 * *goals* and a day's macro *totals* -- the prototype's own `MACRO_GOALS` constant literal and
 * `totals` object share this exact shape, and modelling them as the same type is what makes
 * "totals vs goal" a same-shape comparison everywhere it is rendered (the summary ring, the
 * three macro bars).
 */
export interface MacroTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * The canonical food model (ADR-023), following `Exercise`'s own shape (ADR-017): one
 * interface for both catalogue and custom foods, `ownerUserId: null` marking a catalogue row
 * rather than a separate table -- the same `nullable owner_user_id` + partial-unique-index
 * pattern `nutrition-plan.md`'s locked decisions name explicitly as reused from `exercises`.
 *
 * Not a Postgres row: repositories map columns into this interface, same as `Exercise`.
 */
export interface Food {
  id: string;
  /** `null` for the ingested catalogue (USDA FoodData Central, ADR-023); the owning user's id for a custom food. */
  ownerUserId: string | null;
  name: string;
  category: FoodCategory;
  /** Per 100 g, matching the design's own storage shape (§1) -- a serving's values are always derived, never stored redundantly. */
  macrosPer100g: MacroTotals;
  servings: Serving[];
  /** `null` for a custom food; the adapter's identifier (e.g. "usda_fdc") otherwise -- mirrors `Exercise.source`. */
  source: string | null;
  /** The source dataset's own id for this food, e.g. USDA's `fdc_id`. Mirrors `Exercise.sourceId`. */
  sourceId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
