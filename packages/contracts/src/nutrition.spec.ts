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

    // R10 -- the audit's own example was a 900,000 kcal entry. Pure fat is ~884 kcal/100g,
    // so 900 is a generous per-100g ceiling; a macro gram amount cannot exceed 100g per 100g
    // of food.
    it('rejects an implausible per-100g kcal value (the audit\'s 900,000 kcal example)', () => {
      expect(
        createCustomFoodRequestSchema.safeParse({
          name: 'Corrupt food',
          category: 'snacks',
          kcalPer100g: 900_000,
          proteinPer100g: 1,
          carbsPer100g: 1,
          fatPer100g: 1,
        }).success,
      ).toBe(false);
    });

    it('accepts kcalPer100g up to 900 (pure fat) and rejects above it', () => {
      const base = { name: 'Fatty food', category: 'snacks' as const, proteinPer100g: 0, carbsPer100g: 0 };
      expect(createCustomFoodRequestSchema.safeParse({ ...base, kcalPer100g: 900, fatPer100g: 100 }).success).toBe(
        true,
      );
      expect(createCustomFoodRequestSchema.safeParse({ ...base, kcalPer100g: 901, fatPer100g: 100 }).success).toBe(
        false,
      );
    });

    it('rejects a macro gram amount above 100g per 100g of food', () => {
      expect(
        createCustomFoodRequestSchema.safeParse({
          name: 'Impossible food',
          category: 'snacks',
          kcalPer100g: 100,
          proteinPer100g: 101,
          carbsPer100g: 0,
          fatPer100g: 0,
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

    // R10 -- a single log entry cannot plausibly be a 10-tonne serving.
    it('accepts grams up to 10,000 (10 kg) and rejects above it', () => {
      const base = {
        foodId: '11111111-1111-4111-8111-111111111111',
        slot: 'snack' as const,
        loggedDate: '2026-08-31',
        servingLabel: 'huge',
      };
      expect(logFoodRequestSchema.safeParse({ ...base, grams: 10_000 }).success).toBe(true);
      expect(logFoodRequestSchema.safeParse({ ...base, grams: 10_001 }).success).toBe(false);
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

    it('groupName is nullable, not optional -- the Phase H follow-up name snapshot for a collapsed group', () => {
      expect(nutritionLogEntryResponseSchema.shape.groupName.isOptional()).toBe(false);
      expect(nutritionLogEntryResponseSchema.shape.groupName.isNullable()).toBe(true);
    });
  });

  describe('createSavedMealRequestSchema', () => {
    it('accepts an empty items array -- a meal can be created and populated later', () => {
      expect(createSavedMealRequestSchema.safeParse({ name: 'Breakfast — usual', items: [] }).success).toBe(true);
    });

    // R10 -- an explicit array cap, not the framework's ~100kb body default.
    it('caps items at 50', () => {
      const item = { foodId: '11111111-1111-4111-8111-111111111111', servingLabel: '1 serving', grams: 100 };
      const atCap = { name: 'Big meal', items: Array.from({ length: 50 }, () => ({ ...item })) };
      const tooMany = { name: 'Bigger meal', items: Array.from({ length: 51 }, () => ({ ...item })) };
      expect(createSavedMealRequestSchema.safeParse(atCap).success).toBe(true);
      expect(createSavedMealRequestSchema.safeParse(tooMany).success).toBe(false);
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
