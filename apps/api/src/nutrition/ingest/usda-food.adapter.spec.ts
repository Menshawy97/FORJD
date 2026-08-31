import { CsvTable } from "./csv";
import { UsdaFoodAdapter, UsdaReleaseInput, resolveCategoryMap } from "./usda-food.adapter";

/**
 * Golden-fixture tests for `UsdaFoodAdapter`, mirroring `free-exercise-db.adapter.spec.ts`'s own
 * shape: small, hand-built CSV tables rather than the real 13,694-food dataset, so each
 * assertion is about one deterministic rule (category mapping, kcal precedence, serving
 * fallback) rather than a snapshot of real data.
 */

function table(header: string[], rows: string[][]): CsvTable {
  return { header, rows };
}

const NUTRIENT_TABLE = table(
  ["id", "name", "unit_name", "nutrient_nbr", "rank"],
  [
    ["1008", "Energy", "KCAL", "208", "300"],
    ["2047", "Energy (Atwater General Factors)", "KCAL", "957", "280"],
    ["2048", "Energy (Atwater Specific Factors)", "KCAL", "958", "290"],
    ["1003", "Protein", "G", "203", "600"],
    ["1004", "Total lipid (fat)", "G", "204", "800"],
    ["1005", "Carbohydrate, by difference", "G", "205", "1110"],
  ],
);

const MEASURE_UNIT_TABLE = table(
  ["id", "name"],
  [
    ["1000", "cup"],
    ["1001", "tablespoon"],
    ["9999", "undetermined"],
  ],
);

const SR_LEGACY_CATEGORY_TABLE = table(
  ["id", "code", "description"],
  [
    ["9", "0900", "Fruits and Fruit Juices"],
    ["5", "0500", "Poultry Products"],
  ],
);

function buildRelease(overrides: Partial<UsdaReleaseInput> = {}): UsdaReleaseInput {
  return {
    food: table(
      ["fdc_id", "data_type", "description", "food_category_id", "publication_date"],
      [["100", "foundation_food", "Banana, raw", "9", "2020-01-01"]],
    ),
    foodNutrient: table(
      ["fdc_id", "nutrient_id", "amount"],
      [
        ["100", "2047", "89"],
        ["100", "1003", "1.1"],
        ["100", "1004", "0.3"],
        ["100", "1005", "22.8"],
      ],
    ),
    foodPortion: table(
      ["id", "fdc_id", "seq_num", "amount", "measure_unit_id", "portion_description", "modifier", "gram_weight"],
      [["1", "100", "1", "1", "1000", "", "", "118"]],
    ),
    nutrient: NUTRIENT_TABLE,
    measureUnit: MEASURE_UNIT_TABLE,
    category: SR_LEGACY_CATEGORY_TABLE,
    categoryScheme: "sr_legacy",
    ...overrides,
  };
}

describe("UsdaFoodAdapter", () => {
  it("normalizes a food's category, macros and serving from a hand-built release", () => {
    const adapter = new UsdaFoodAdapter([buildRelease()]);

    const [food] = adapter.normalizeAll();

    expect(food).toEqual({
      source: "usda_fdc",
      sourceId: "100",
      name: "Banana, raw",
      category: "fruits",
      macrosPer100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
      servings: [{ label: "1 cup", grams: 118 }],
    });
  });

  it("prefers Atwater General over Atwater Specific over plain Energy for kcal", () => {
    const withAllThreeEnergies = buildRelease({
      foodNutrient: table(
        ["fdc_id", "nutrient_id", "amount"],
        [
          ["100", "1008", "100"],
          ["100", "2048", "95"],
          ["100", "2047", "90"],
        ],
      ),
    });

    const [food] = new UsdaFoodAdapter([withAllThreeEnergies]).normalizeAll();

    expect(food?.macrosPer100g.kcal).toBe(90);
  });

  it("falls back to plain Energy when no Atwater variant is present", () => {
    const plainEnergyOnly = buildRelease({
      foodNutrient: table(["fdc_id", "nutrient_id", "amount"], [["100", "1008", "52"]]),
    });

    const [food] = new UsdaFoodAdapter([plainEnergyOnly]).normalizeAll();

    expect(food?.macrosPer100g.kcal).toBe(52);
  });

  it("gives a food with no food_nutrient rows zero macros rather than throwing", () => {
    const noNutrients = buildRelease({ foodNutrient: table(["fdc_id", "nutrient_id", "amount"], []) });

    const [food] = new UsdaFoodAdapter([noNutrients]).normalizeAll();

    expect(food?.macrosPer100g).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("normalizes with an empty servings list when food_portion has no rows for it -- gram-only, per the Phase A decision", () => {
    const noPortions = buildRelease({
      foodPortion: table(
        ["id", "fdc_id", "seq_num", "amount", "measure_unit_id", "portion_description", "modifier", "gram_weight"],
        [],
      ),
    });

    const [food] = new UsdaFoodAdapter([noPortions]).normalizeAll();

    expect(food?.servings).toEqual([]);
  });

  it("falls back to portion_description when measure_unit_id is undetermined (9999)", () => {
    const undeterminedUnit = buildRelease({
      foodPortion: table(
        ["id", "fdc_id", "seq_num", "amount", "measure_unit_id", "portion_description", "modifier", "gram_weight"],
        [["1", "100", "1", "1", "9999", "1 small banana", "", "101"]],
      ),
    });

    const [food] = new UsdaFoodAdapter([undeterminedUnit]).normalizeAll();

    expect(food?.servings).toEqual([{ label: "1 small banana", grams: 101 }]);
  });

  it("resolves a WWEIA-scheme category by id directly, not by name", () => {
    const wweiaRelease = buildRelease({
      food: table(
        ["fdc_id", "data_type", "description", "food_category_id", "publication_date"],
        [["200", "survey_fndds_food", "Milk, whole", "1002", "2020-01-01"]],
      ),
      category: table(["wweia_food_category", "wweia_food_category_description"], [["1002", "Milk, whole"]]),
      categoryScheme: "wweia",
    });

    const [food] = new UsdaFoodAdapter([wweiaRelease]).normalizeAll();

    expect(food?.category).toBe("dairy");
  });

  it("throws when a food's own category id resolves to nothing in the release's mapped categories", () => {
    const unmappedCategoryFood = buildRelease({
      food: table(
        ["fdc_id", "data_type", "description", "food_category_id", "publication_date"],
        [["300", "foundation_food", "Mystery item", "999", "2020-01-01"]],
      ),
    });

    expect(() => new UsdaFoodAdapter([unmappedCategoryFood]).normalizeAll()).toThrow(/unresolved category id/);
  });

  it("normalizes across multiple releases into one flat list", () => {
    const second = buildRelease({
      food: table(
        ["fdc_id", "data_type", "description", "food_category_id", "publication_date"],
        [["101", "foundation_food", "Chicken breast, raw", "5", "2020-01-01"]],
      ),
      foodNutrient: table(["fdc_id", "nutrient_id", "amount"], [["101", "1008", "120"]]),
      foodPortion: table(
        ["id", "fdc_id", "seq_num", "amount", "measure_unit_id", "portion_description", "modifier", "gram_weight"],
        [],
      ),
    });

    const foods = new UsdaFoodAdapter([buildRelease(), second]).normalizeAll();

    expect(foods.map((food) => food.sourceId).sort()).toEqual(["100", "101"]);
    expect(foods.find((food) => food.sourceId === "101")?.category).toBe("protein");
  });
});

describe("resolveCategoryMap", () => {
  it("skips a category present in the lookup file but never referenced by a real food, without throwing", () => {
    const categoryTableWithAnUnmappedRow = table(
      ["id", "code", "description"],
      [
        ["9", "0900", "Fruits and Fruit Juices"],
        ["26", "9999", "Branded Food Products Database"], // present in USDA's own lookup, unmapped in mappings.ts
      ],
    );

    const map = resolveCategoryMap(categoryTableWithAnUnmappedRow, "sr_legacy");

    expect(map.get("9")).toBe("fruits");
    expect(map.has("26")).toBe(false);
  });
});
