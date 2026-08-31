/**
 * Every closed nutrition-vocabulary tuple must have a matching entry in its *DisplayName map
 * -- this test is the enforcement, mirroring exercise-vocabulary.spec.ts's own pattern.
 * Written before the tuples exist (Phase B, RED first) per the standing TDD rule.
 */
import {
  MEAL_SLOTS,
  MEAL_SLOT_DISPLAY_NAMES,
  FOOD_CATEGORIES,
  FOOD_CATEGORY_DISPLAY_NAMES,
} from "./index";

describe("nutrition vocabulary display-name coverage", () => {
  const cases: Array<[string, readonly string[], Record<string, string>]> = [
    ["MEAL_SLOTS", MEAL_SLOTS, MEAL_SLOT_DISPLAY_NAMES],
    ["FOOD_CATEGORIES", FOOD_CATEGORIES, FOOD_CATEGORY_DISPLAY_NAMES],
  ];

  it.each(cases)("every %s member has a non-empty display name", (_label, tuple, map) => {
    for (const member of tuple) {
      const name = map[member];
      expect(name).toBeDefined();
      expect(typeof name).toBe("string");
      expect((name ?? "").length).toBeGreaterThan(0);
    }
  });

  it.each(cases)("%s display-name map has no orphan keys", (_label, tuple, map) => {
    const known = new Set<string>(tuple);
    for (const key of Object.keys(map)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("MEAL_SLOTS matches the design's SLOTS order exactly -- Snack third, not last", () => {
    expect(MEAL_SLOTS).toEqual(["breakfast", "lunch", "snack", "dinner"]);
  });

  it("FOOD_CATEGORIES matches the design's FOOD_CATS order exactly, excluding the 'All' filter chip", () => {
    // The prototype's FOOD_CATS is ['All', 'Protein', 'Grains', 'Fruits', 'Vegetables',
    // 'Dairy', 'Snacks', 'Fats', 'Beverages'] -- 'All' is a library filter-chip value, not a
    // real food category, the same distinction the library screen's 'All'/'Favourites' chips
    // already draw for exercises without either being an ExerciseCategory member.
    expect(FOOD_CATEGORIES).toEqual([
      "protein",
      "grains",
      "fruits",
      "vegetables",
      "dairy",
      "snacks",
      "fats",
      "beverages",
    ]);
  });
});
