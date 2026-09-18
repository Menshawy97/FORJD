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
  interface Calls {
    upserted: NormalizedFood[] | null;
    pruned: { source: string; keep: readonly string[] } | null;
    order: string[];
  }

  function fakeTarget(existingCount: number, calls: Calls): FoodCatalogueTarget {
    return {
      bulkUpsertCatalogueFoods: async (inputs) => {
        calls.upserted = inputs;
        calls.order.push("upsert");
      },
      countCatalogueFoods: async () => existingCount,
      pruneCatalogueFoods: async (source, keep) => {
        calls.pruned = { source, keep };
        calls.order.push("prune");
        return { deleted: 2, softDeleted: 1 };
      },
    };
  }

  const newCalls = (): Calls => ({ upserted: null, pruned: null, order: [] });

  it("bulk-upserts the whole catalogue in one call, then prunes rows absent from it", async () => {
    const calls = newCalls();
    const foodsToLoad = [food("1"), food("2"), food("3")];

    const result = await loadCatalogue(fakeTarget(3, calls), foodsToLoad);

    expect(result).toEqual({ loaded: 3, deleted: 2, softDeleted: 1, pruneSkipped: false });
    expect(calls.upserted).toEqual(foodsToLoad);
    expect(calls.pruned).toEqual({ source: "usda_fdc", keep: ["1", "2", "3"] });
    expect(calls.order).toEqual(["upsert", "prune"]);
  });

  it("skips the prune, without failing, when it would remove more than 20% of the catalogue", async () => {
    const calls = newCalls();

    // 100 rows exist after the upsert, the snapshot has 3: 97% stale -- a wrong or truncated snapshot.
    const result = await loadCatalogue(fakeTarget(100, calls), [food("1"), food("2"), food("3")]);

    expect(result).toEqual({ loaded: 3, deleted: 0, softDeleted: 0, pruneSkipped: true });
    expect(calls.pruned).toBeNull();
    expect(calls.order).toEqual(["upsert"]);
  });

  it("allows a prune of exactly 20% but not more", async () => {
    const at20 = newCalls();
    const over20 = newCalls();
    const eighty = Array.from({ length: 80 }, (_, i) => food(String(i)));

    expect((await loadCatalogue(fakeTarget(100, at20), eighty)).pruneSkipped).toBe(false);
    expect((await loadCatalogue(fakeTarget(101, over20), eighty)).pruneSkipped).toBe(true);
  });

  it("never prunes an empty snapshot", async () => {
    const calls = newCalls();

    const result = await loadCatalogue(fakeTarget(50, calls), []);

    expect(result).toEqual({ loaded: 0, deleted: 0, softDeleted: 0, pruneSkipped: true });
    expect(calls.pruned).toBeNull();
  });

  it("rejects without swallowing an upsert error, and does not prune after it", async () => {
    const calls = newCalls();
    const target: FoodCatalogueTarget = {
      ...fakeTarget(1, calls),
      bulkUpsertCatalogueFoods: async () => {
        throw new Error("boom");
      },
    };

    await expect(loadCatalogue(target, [food("1")])).rejects.toThrow("boom");
    expect(calls.pruned).toBeNull();
  });
});
