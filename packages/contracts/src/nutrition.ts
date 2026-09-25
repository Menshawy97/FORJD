import { ACTIVITY_LEVELS, BODY_GOALS, FOOD_CATEGORIES, MEAL_SLOTS } from '@forjd/domain';
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Nutrition (Phase 2.5, ADR-023)
// ---------------------------------------------------------------------------------------------

export const mealSlotSchema = z.enum(MEAL_SLOTS);
export const foodCategorySchema = z.enum(FOOD_CATEGORIES);

/** A plain `YYYY-MM-DD` calendar day, the client's own local date -- never server-derived. See `nutrition.schema.ts`'s docblock on `nutritionLogEntries` for why. */
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const servingSchema = z.object({
  label: z.string(),
  grams: z.number(),
});

const macroTotalsSchema = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

/**
 * A food, catalogue or custom, for both the search result row and the detail screen -- unlike
 * exercises, nothing here is heavy enough (no instructions list, no image URLs) to justify a
 * separate lean summary shape. `source`/`sourceId`/`deletedAt` never reach the wire, matching
 * `exerciseResponseSchema`'s own reasoning: nothing in the design draws them.
 */
export const foodResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: foodCategorySchema,
  macrosPer100g: macroTotalsSchema,
  servings: z.array(servingSchema),
  /** True for a user-authored food -- derived from `ownerUserId !== null`, never the id itself. */
  isCustom: z.boolean(),
});
export type FoodResponse = z.infer<typeof foodResponseSchema>;

/**
 * `GET /nutrition/foods`. No cursor: the design's food-search screen (`nutrition-screen-
 * specs.md` §3) is a narrow-as-you-type list, not an infinite-scroll browse like the exercise
 * library, so there is no "load more" affordance to page through -- unlike
 * `exerciseListQuerySchema`, a bounded `limit` is enough and `listResponseSchema`'s `nextCursor`
 * contract (a positive "no more results" statement) would be meaningless here, since
 * `NutritionRepository.searchFoods` truncates at `limit` without reporting whether more exist.
 */
export const foodSearchQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    })
    .pipe(z.string().max(80).optional()),
  category: foodCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type FoodSearchQuery = z.infer<typeof foodSearchQuerySchema>;

export const foodListResponseSchema = z.object({ items: z.array(foodResponseSchema) });
export type FoodListResponse = z.infer<typeof foodListResponseSchema>;

/**
 * Body for `POST /nutrition/foods` (a custom food). Per-100g values only, matching the design's
 * own "Enter values per 100 g" hint (`nutrition-screen-specs.md` §3) -- a serving is always
 * derived from these, never stored redundantly.
 */
export const createCustomFoodRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: foodCategorySchema,
  // R10 -- the audit's own example was a 900,000 kcal entry. Pure fat is ~884 kcal/100g;
  // 900 is a generous ceiling. A macro cannot exceed 100g per 100g of food.
  kcalPer100g: z.number().min(0).max(900),
  proteinPer100g: z.number().min(0).max(100),
  carbsPer100g: z.number().min(0).max(100),
  fatPer100g: z.number().min(0).max(100),
});
export type CreateCustomFoodRequest = z.infer<typeof createCustomFoodRequestSchema>;

/**
 * `{ kcal, protein, carbs, fat }`, reused for both goals and a day's totals -- the same
 * same-shape-everywhere reasoning `MacroTotals` states in `@forjd/domain`.
 */
export const macroGoalsResponseSchema = macroTotalsSchema;
export type MacroGoalsResponse = z.infer<typeof macroGoalsResponseSchema>;

/** Body for `PUT /nutrition/macro-goals`. All four required -- an upsert always writes a complete row, there is no partial-goals concept. */
export const setMacroGoalsRequestSchema = z.object({
  kcal: z.number().positive(),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
});
export type SetMacroGoalsRequest = z.infer<typeof setMacroGoalsRequestSchema>;

/** What a suggestion cannot be worked out without: the answer to show instead of numbers. */
export const MACRO_SUGGESTION_MISSING = ['activityLevel', 'bodyGoal', 'weight', 'bmr'] as const;

/**
 * `GET /nutrition/macro-goals/suggestion` (docs/product/scan-height-age-plan.md §4.5). A suggestion
 * only: the app shows it on Set daily goals and the user taps Use to save it through
 * `PUT /nutrition/macro-goals`, in the same `{ kcal, protein, carbs, fat }` shape. `basis` is every
 * input and constant the (i) details show, so the app never recomputes. When something is missing
 * (no activity level, goal, weight, or a BMR from a scan or Mifflin–St Jeor), `suggestion` and
 * `basis` are null and `missing` says what to add.
 */
export const macroGoalSuggestionResponseSchema = z.object({
  suggestion: macroTotalsSchema.nullable(),
  basis: z
    .object({
      maintenanceKcal: z.number(),
      bmrKcal: z.number(),
      /** `scan`: the latest InBody scan's (measured or calculated); `estimate`: Mifflin–St Jeor. */
      bmrSource: z.enum(['scan', 'estimate']),
      scanMeasuredAt: z.string().datetime().nullable(),
      weightKg: z.number(),
      activityLevel: z.enum(ACTIVITY_LEVELS),
      activityFactor: z.number(),
      bodyGoal: z.enum(BODY_GOALS),
      /** −0.15 for lose fat, −0.05 recomposition, 0 maintain, +0.10 build muscle. */
      energyChange: z.number(),
      proteinPerKg: z.number(),
      fatShare: z.number(),
      /** The daily minimum the suggestion was raised to, or `null` when the goal already cleared it
       *  (whole-app review 8.5, L6-1). Optional so older servers' responses still parse (rule 7). */
      minimumKcalApplied: z.number().nullable().optional(),
    })
    .nullable(),
  missing: z.array(z.enum(MACRO_SUGGESTION_MISSING)),
});
export type MacroGoalSuggestionResponse = z.infer<typeof macroGoalSuggestionResponseSchema>;

/**
 * A logged food entry. Macro values are the snapshot `NutritionRepository.logEntry` computed
 * and stored at log time, never a live re-computation against the food's current values --
 * `nutrition.schema.ts`'s docblock on `nutritionLogEntries` explains why (a later edit to a
 * food must not silently rewrite what a user is told they ate on a past day). No food name or
 * category here: joining that in is a later phase's job (the dashboard already has the food id
 * to look up if it needs the name), not this vertical slice's.
 */
export const nutritionLogEntryResponseSchema = z.object({
  id: z.string().uuid(),
  foodId: z.string().uuid(),
  loggedDate: localDateSchema,
  slot: mealSlotSchema,
  servingLabel: z.string(),
  grams: z.number(),
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  groupId: z.string().uuid().nullable(),
  /**
   * The saved meal's name, snapshotted at `logSavedMeal` time; `null` for an individually
   * logged item. A Phase H follow-up (`nutrition-plan.md`) -- the dashboard's collapsed-group
   * row needs a name source that `groupId` alone never provided.
   */
  groupName: z.string().nullable(),
});
export type NutritionLogEntryResponse = z.infer<typeof nutritionLogEntryResponseSchema>;

export const nutritionLogListResponseSchema = z.object({ items: z.array(nutritionLogEntryResponseSchema) });
export type NutritionLogListResponse = z.infer<typeof nutritionLogListResponseSchema>;

/**
 * Body for `POST /nutrition/log`. `servingLabel` and `grams` are supplied by the client (the
 * selected serving or a custom-amount gram value) but never a macro value -- the service
 * computes and snapshots macros server-side from the food's own per-100g values, per the
 * plan's carried-forward decision. A caller-supplied macro value would let a buggy or
 * malicious client log any calorie count against any food.
 */
export const logFoodRequestSchema = z.object({
  /** Optional, client-generated: the same id sent twice logs the food once, so retrying after a
   *  dropped response cannot double a day's calories (whole-app review 8.5, L4-1). Additive (rule 7). */
  id: z.string().uuid().optional(),
  foodId: z.string().uuid(),
  slot: mealSlotSchema,
  loggedDate: localDateSchema,
  servingLabel: z.string().min(1),
  /** `0` is valid -- the design's "Custom amount" accepts 0 g and logs a 0-kcal entry
   *  (`nutrition-screen-specs.md` §4). `.max(10_000)` (R10): no single logged item is
   *  plausibly a 10kg serving. */
  grams: z.number().min(0).max(10_000),
});
export type LogFoodRequest = z.infer<typeof logFoodRequestSchema>;

/** Body for `POST /nutrition/log/meal` -- logs every item of a saved meal, sharing one `groupId`. */
export const logSavedMealRequestSchema = z.object({
  savedMealId: z.string().uuid(),
  slot: mealSlotSchema,
  loggedDate: localDateSchema,
});
export type LogSavedMealRequest = z.infer<typeof logSavedMealRequestSchema>;

const savedMealItemSchema = z.object({
  foodId: z.string().uuid(),
  servingLabel: z.string().min(1),
  grams: z.number().min(0).max(10_000),
});

/** Body for `POST /nutrition/meals`. Items are copied into a day's log when the meal is logged, never referenced live -- see `NutritionRepository.logSavedMeal`'s own docblock.
 *  `.max(50)` (R10): an explicit cap, not the framework's ~100kb body default. */
export const createSavedMealRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(savedMealItemSchema).max(50),
});
export type CreateSavedMealRequest = z.infer<typeof createSavedMealRequestSchema>;

export const savedMealResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  items: z.array(
    z.object({
      foodId: z.string().uuid(),
      servingLabel: z.string(),
      grams: z.number(),
    }),
  ),
});
export type SavedMealResponse = z.infer<typeof savedMealResponseSchema>;

export const savedMealListResponseSchema = z.object({ items: z.array(savedMealResponseSchema) });
export type SavedMealListResponse = z.infer<typeof savedMealListResponseSchema>;
