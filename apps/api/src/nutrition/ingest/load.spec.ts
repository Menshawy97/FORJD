import { FoodCatalogueTarget, loadCatalogue, parseSnapshot } from "./load";
import { NormalizedFood } from "./usda-food-source-adapter.interface";

/** Mirrors `exercises/ingest/load.spec.ts`: pure functions tested against a fake target, no database or filesystem. */

function food(sourceId: string): NormalizedFood {
  return {
    source: "usda_fdc",
    sourceId,
    name: `Food ${sourceId}`,
    category: "snacks",
    macrosPer100g: { kcal: 100, protein: 1, carbs: 2, fat: 3 },
    servings: [],
  };
}

describe("parseSnapshot", () => {
  it("returns the foods array when the declared count matches", () => {
    const foods = [food("1"), food("2")];

    expect(parseSnapshot({ count: 2, foods })).toEqual(foods);
  });

  it("throws when the top level is not an object", () => {
    expect(() => parseSnapshot(["not", "an", "object"])).toThrow(/expected a JSON object/);
    expect(() => parseSnapshot(null)).toThrow(/expected a JSON object/);
  });

  it("throws when foods is not an array", () => {
    expect(() => parseSnapshot({ count: 0, foods: "nope" })).toThrow(/"foods" is not an array/);
  });

  it("throws when the declared count does not match the array length -- a truncated or hand-edited snapshot", () => {
    expect(() => parseSnapshot({ count: 5, foods: [food("1")] })).toThrow(/declares count 5 but carries 1/);
  });

  it("throws when a food is missing source or sourceId -- would defeat the partial unique index", () => {
    const missingSource = { ...food("1"), source: "" };
    expect(() => parseSnapshot({ count: 1, foods: [missingSource] })).toThrow(/has no source/);

    const missingSourceId = { ...food("1"), sourceId: "" };
    expect(() => parseSnapshot({ count: 1, foods: [missingSourceId] })).toThrow(/has no sourceId/);
  });
});

describe("loadCatalogue", () => {
  it("upserts every food sequentially and reports the count loaded", async () => {
    const calls: NormalizedFood[] = [];
    const target: FoodCatalogueTarget = {
      createCatalogueFood: async (input) => {
        calls.push(input);
      },
    };

    const result = await loadCatalogue(target, [food("1"), food("2"), food("3")]);

    expect(result).toEqual({ loaded: 3 });
    expect(calls.map((call) => call.sourceId)).toEqual(["1", "2", "3"]);
  });

  it("rejects on the first failure without swallowing the error", async () => {
    const target: FoodCatalogueTarget = {
      createCatalogueFood: async () => {
        throw new Error("boom");
      },
    };

    await expect(loadCatalogue(target, [food("1")])).rejects.toThrow("boom");
  });
});
