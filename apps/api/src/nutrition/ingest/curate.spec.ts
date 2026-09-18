import { FOOD_NAME_EXCLUSIONS } from "./food-exclusions";
import { curateCatalogue, CuratableFood, normalizeFoodName } from "./curate";

function food(overrides: Partial<CuratableFood> & { sourceId: string }): CuratableFood {
  return {
    source: "usda_fdc",
    name: `Food ${overrides.sourceId}`,
    category: "snacks",
    macrosPer100g: { kcal: 100, protein: 1, carbs: 2, fat: 3 },
    servings: [],
    dataType: "sr_legacy",
    ...overrides,
  };
}

const EXCLUSIONS = [{ pattern: /^APPLEBEE'S,/i, reason: "Applebee's" }];

describe("normalizeFoodName", () => {
  it("lowercases, collapses whitespace and trims trailing punctuation", () => {
    expect(normalizeFoodName("  Pasta, dry,  whole grain, spaghetti  ")).toBe("pasta, dry, whole grain, spaghetti");
    expect(normalizeFoodName("Garlic, raw.")).toBe("garlic, raw");
  });
});

describe("curateCatalogue", () => {
  it("removes a food matching a blocked-name pattern", () => {
    const { kept, removed } = curateCatalogue(
      [food({ sourceId: "1", name: "APPLEBEE'S, french fries" }), food({ sourceId: "2", name: "Banana, raw" })],
      EXCLUSIONS,
    );

    expect(kept.map((f) => f.sourceId)).toEqual(["2"]);
    expect(removed).toEqual([{ sourceId: "1", name: "APPLEBEE'S, french fries", reason: "blocked: Applebee's" }]);
  });

  it("removes a zero-calorie food that is not a beverage", () => {
    const { kept, removed } = curateCatalogue(
      [food({ sourceId: "1", name: "Salt, table", macrosPer100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 } })],
      [],
    );

    expect(kept).toEqual([]);
    expect(removed[0]?.reason).toBe("zero-calorie");
  });

  it("keeps a zero-calorie beverage such as water or black coffee", () => {
    const { kept } = curateCatalogue(
      [
        food({
          sourceId: "1",
          name: "Water, tap",
          category: "beverages",
          macrosPer100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
        }),
      ],
      [],
    );

    expect(kept.map((f) => f.sourceId)).toEqual(["1"]);
  });

  it("keeps one food per normalized name, preferring one with servings", () => {
    const { kept, removed } = curateCatalogue(
      [
        food({ sourceId: "1", name: "Garlic, raw", dataType: "foundation" }),
        food({ sourceId: "2", name: "garlic, raw", dataType: "sr_legacy", servings: [{ label: "1 clove", grams: 3 }] }),
      ],
      [],
    );

    expect(kept.map((f) => f.sourceId)).toEqual(["2"]);
    expect(removed).toEqual([{ sourceId: "1", name: "Garlic, raw", reason: "duplicate", keptSourceId: "2" }]);
  });

  it("breaks a servings tie by data type (foundation > sr_legacy > survey), then by lowest sourceId", () => {
    const { kept } = curateCatalogue(
      [
        food({ sourceId: "9", name: "Kale, raw", dataType: "survey" }),
        food({ sourceId: "5", name: "Kale, raw", dataType: "sr_legacy" }),
        food({ sourceId: "7", name: "Kale, raw", dataType: "sr_legacy" }),
      ],
      [],
    );

    expect(kept.map((f) => f.sourceId)).toEqual(["5"]);
  });

  it("drops a zero-calorie duplicate before deduplicating, so it can never be the survivor", () => {
    const { kept } = curateCatalogue(
      [
        food({ sourceId: "1", name: "Garlic, raw", macrosPer100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 } }),
        food({ sourceId: "2", name: "Garlic, raw", dataType: "survey" }),
      ],
      [],
    );

    expect(kept.map((f) => f.sourceId)).toEqual(["2"]);
  });

  it("preserves input order for the foods it keeps", () => {
    const { kept } = curateCatalogue([food({ sourceId: "3" }), food({ sourceId: "1" }), food({ sourceId: "2" })], []);

    expect(kept.map((f) => f.sourceId)).toEqual(["3", "1", "2"]);
  });
});

describe("FOOD_NAME_EXCLUSIONS", () => {
  it("every rule carries a reason and a case-insensitive pattern", () => {
    for (const rule of FOOD_NAME_EXCLUSIONS) {
      expect(rule.reason.length).toBeGreaterThan(0);
      expect(rule.pattern.flags).toContain("i");
    }
  });
});

describe("the committed catalogue", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const removed = (require("./data/removed-foods.json") as { removed: { reason: string }[] }).removed;

  it("has at least one removal for every FOOD_NAME_EXCLUSIONS rule -- a dead or mistyped rule fails here", () => {
    for (const rule of FOOD_NAME_EXCLUSIONS) {
      expect(removed.some((entry) => entry.reason === `blocked: ${rule.reason}`)).toBe(true);
    }
  });
});
