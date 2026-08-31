import {
  createCustomFoodRequestSchema,
  createSavedMealRequestSchema,
  foodListResponseSchema,
  foodSearchQuerySchema,
  logFoodRequestSchema,
  logSavedMealRequestSchema,
  macroGoalsResponseSchema,
  nutritionLogEntryResponseSchema,
  setMacroGoalsRequestSchema,
} from './index';

/** Pins the deliberate decisions in the nutrition contracts (Phase E) -- not exhaustive re-tests of Zod itself. */
describe('nutrition contracts', () => {
  describe('foodSearchQuerySchema', () => {
    it('defaults limit to 30, bounded at 50', () => {
      expect(foodSearchQuerySchema.parse({}).limit).toBe(30);
      expect(foodSearchQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
      expect(foodSearchQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    });

    it('treats a blank q as no search, not a validation error -- clearing the search box sends ?q=', () => {
      expect(foodSearchQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
      expect(foodSearchQuerySchema.parse({ q: '' }).q).toBeUndefined();
    });

    it('trims before bounding, so surrounding whitespace does not push a term over the length limit', () => {
      const term = 'a'.repeat(80);
      expect(foodSearchQuerySchema.parse({ q: `  ${term}  ` }).q).toBe(term);
    });

    it('rejects an unknown category rather than silently ignoring it', () => {
      expect(foodSearchQuerySchema.safeParse({ category: 'not-a-real-category' }).success).toBe(false);
    });
  });

  describe('foodListResponseSchema', () => {
    it('has no nextCursor field -- food search is not paginated like the exercise browse list', () => {
      const shape = foodListResponseSchema.shape;
      expect(Object.keys(shape)).toEqual(['items']);
    });
  });

  describe('createCustomFoodRequestSchema', () => {
    it('accepts per-100g macro values and rejects negative ones', () => {
      const valid = createCustomFoodRequestSchema.safeParse({
        name: "Mom's protein pancakes",
        category: 'grains',
        kcalPer100g: 210,
        proteinPer100g: 12,
        carbsPer100g: 28,
        fatPer100g: 5,
      });
      expect(valid.success).toBe(true);

      expect(
        createCustomFoodRequestSchema.safeParse({
          name: 'Bad food',
          category: 'grains',
          kcalPer100g: -1,
          proteinPer100g: 0,
          carbsPer100g: 0,
          fatPer100g: 0,
        }).success,
      ).toBe(false);
    });

    it('rejects an empty name', () => {
      expect(
        createCustomFoodRequestSchema.safeParse({
          name: '',
          category: 'snacks',
          kcalPer100g: 1,
          proteinPer100g: 1,
          carbsPer100g: 1,
          fatPer100g: 1,
        }).success,
      ).toBe(false);
    });
  });

  describe('logFoodRequestSchema', () => {
    it('carries no macro fields at all -- the service computes them server-side, never from wire input', () => {
      expect(Object.keys(logFoodRequestSchema.shape).sort()).toEqual(
        ['foodId', 'slot', 'loggedDate', 'servingLabel', 'grams'].sort(),
      );
    });

    it('accepts grams: 0, matching the design\'s "Custom amount" accepting a 0 g entry', () => {
      const result = logFoodRequestSchema.safeParse({
        foodId: '11111111-1111-4111-8111-111111111111',
        slot: 'snack',
        loggedDate: '2026-08-31',
        servingLabel: '0 g (custom)',
        grams: 0,
      });
      expect(result.success).toBe(true);
    });

    it('rejects negative grams', () => {
      expect(
        logFoodRequestSchema.safeParse({
          foodId: '11111111-1111-4111-8111-111111111111',
          slot: 'snack',
          loggedDate: '2026-08-31',
          servingLabel: 'oops',
          grams: -1,
        }).success,
      ).toBe(false);
    });

    it('rejects a malformed loggedDate', () => {
      expect(
        logFoodRequestSchema.safeParse({
          foodId: '11111111-1111-4111-8111-111111111111',
          slot: 'snack',
          loggedDate: '31-08-2026',
          servingLabel: 'oops',
          grams: 10,
        }).success,
      ).toBe(false);
    });

    it('rejects an unknown meal slot', () => {
      expect(
        logFoodRequestSchema.safeParse({
          foodId: '11111111-1111-4111-8111-111111111111',
          slot: 'brunch',
          loggedDate: '2026-08-31',
          servingLabel: 'oops',
          grams: 10,
        }).success,
      ).toBe(false);
    });
  });

  describe('logSavedMealRequestSchema', () => {
    it('requires savedMealId, slot and loggedDate only', () => {
      expect(Object.keys(logSavedMealRequestSchema.shape).sort()).toEqual(
        ['savedMealId', 'slot', 'loggedDate'].sort(),
      );
    });
  });

  describe('nutritionLogEntryResponseSchema', () => {
    it('has no food name or category -- joining that in is a later phase\'s job', () => {
      expect(Object.keys(nutritionLogEntryResponseSchema.shape)).not.toContain('foodName');
      expect(Object.keys(nutritionLogEntryResponseSchema.shape)).not.toContain('category');
    });

    it('groupId is nullable, not optional -- "not part of a group" is a stated value', () => {
      expect(nutritionLogEntryResponseSchema.shape.groupId.isOptional()).toBe(false);
      expect(nutritionLogEntryResponseSchema.shape.groupId.isNullable()).toBe(true);
    });
  });

  describe('createSavedMealRequestSchema', () => {
    it('accepts an empty items array -- a meal can be created and populated later', () => {
      expect(createSavedMealRequestSchema.safeParse({ name: 'Breakfast — usual', items: [] }).success).toBe(true);
    });
  });

  describe('macroGoalsResponseSchema / setMacroGoalsRequestSchema', () => {
    it('share the same shape as MacroTotals, kcal/protein/carbs/fat only', () => {
      expect(Object.keys(macroGoalsResponseSchema.shape).sort()).toEqual(
        ['kcal', 'protein', 'carbs', 'fat'].sort(),
      );
    });

    it('rejects a zero or negative kcal goal, but allows protein/carbs/fat of 0', () => {
      expect(setMacroGoalsRequestSchema.safeParse({ kcal: 0, protein: 0, carbs: 0, fat: 0 }).success).toBe(false);
      expect(setMacroGoalsRequestSchema.safeParse({ kcal: 1, protein: 0, carbs: 0, fat: 0 }).success).toBe(true);
    });
  });
});
