import { NotFoundException } from "@nestjs/common";
import { Food, User } from "@forjd/domain";

import { NutritionLogEntry, NutritionRepository, SavedMealWithItems } from "./nutrition.repository";
import { NutritionService } from "./nutrition.service";

/**
 * Unit suite against a fake `NutritionRepository`, mirroring `exercises.service.spec.ts`'s own
 * shape: the repository never distinguishes "no such row" from "not yours" (null/false), so
 * this suite is where the 404-never-403 policy and the "never trust a client macro value"
 * decision are actually pinned.
 */

const viewer: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "viewer@example.com",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const stranger: User = { ...viewer, id: "22222222-2222-4222-8222-222222222222" };

function catalogueFood(overrides: Partial<Food> = {}): Food {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    ownerUserId: null,
    name: "Banana, raw",
    category: "fruits",
    macrosPer100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
    servings: [{ label: "1 medium", grams: 118 }],
    source: "usda_fdc",
    sourceId: "1105073",
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function customFood(ownerUserId: string, overrides: Partial<Food> = {}): Food {
  return catalogueFood({
    id: "44444444-4444-4444-8444-444444444444",
    ownerUserId,
    source: null,
    sourceId: null,
    ...overrides,
  });
}

function logEntry(overrides: Partial<NutritionLogEntry> = {}): NutritionLogEntry {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    userId: viewer.id,
    foodId: catalogueFood().id,
    loggedDate: "2026-08-31",
    slot: "breakfast",
    servingLabel: "1 medium",
    grams: 118,
    kcal: 105,
    protein: 1.3,
    carbs: 26.9,
    fat: 0.35,
    groupId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function savedMeal(overrides: Partial<SavedMealWithItems> = {}): SavedMealWithItems {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    userId: viewer.id,
    name: "Breakfast — usual",
    items: [{ foodId: catalogueFood().id, servingLabel: "1 medium", grams: 118 }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeRepository(): jest.Mocked<NutritionRepository> {
  return {
    searchFoods: jest.fn(),
    findFoodById: jest.fn(),
    createCustomFood: jest.fn(),
    softDeleteCustomFood: jest.fn(),
    getMacroGoals: jest.fn(),
    setMacroGoals: jest.fn(),
    listSavedMeals: jest.fn(),
    createSavedMeal: jest.fn(),
    deleteSavedMeal: jest.fn(),
    listLogForDate: jest.fn(),
    logEntry: jest.fn(),
    logSavedMeal: jest.fn(),
    deleteLogEntry: jest.fn(),
    deleteLogGroup: jest.fn(),
  } as unknown as jest.Mocked<NutritionRepository>;
}

describe("NutritionService", () => {
  let repository: jest.Mocked<NutritionRepository>;
  let service: NutritionService;

  beforeEach(() => {
    repository = fakeRepository();
    service = new NutritionService(repository);
  });

  describe("searchFoods", () => {
    it("returns no results for a blank query, without calling the repository", async () => {
      const result = await service.searchFoods(viewer, { limit: 30 });

      expect(result).toEqual({ items: [] });
      expect(repository.searchFoods).not.toHaveBeenCalled();
    });

    it("passes the term, limit and category straight through, and maps isCustom from ownerUserId", async () => {
      repository.searchFoods.mockResolvedValue([catalogueFood(), customFood(viewer.id)]);

      const result = await service.searchFoods(viewer, { q: "banana", limit: 10, category: "fruits" });

      expect(repository.searchFoods).toHaveBeenCalledWith(viewer.id, "banana", 10, "fruits");
      expect(result.items.map((food) => food.isCustom)).toEqual([false, true]);
      expect(result.items.every((food) => !("ownerUserId" in food))).toBe(true);
    });
  });

  describe("getFoodById", () => {
    it("returns a catalogue food to anyone", async () => {
      repository.findFoodById.mockResolvedValue(catalogueFood());

      const result = await service.getFoodById(stranger, catalogueFood().id);

      expect(result.isCustom).toBe(false);
    });

    it("returns the owner's own custom food", async () => {
      repository.findFoodById.mockResolvedValue(customFood(viewer.id));

      const result = await service.getFoodById(viewer, customFood(viewer.id).id);

      expect(result.isCustom).toBe(true);
    });

    it("404s, never throws a different error, for another user's custom food", async () => {
      repository.findFoodById.mockResolvedValue(customFood(viewer.id));

      await expect(service.getFoodById(stranger, customFood(viewer.id).id)).rejects.toThrow(NotFoundException);
    });

    it("404s for an id that resolves to nothing", async () => {
      repository.findFoodById.mockResolvedValue(null);

      await expect(service.getFoodById(viewer, "does-not-exist")).rejects.toThrow(NotFoundException);
    });
  });

  describe("createCustomFood / deleteCustomFood", () => {
    it("builds macrosPer100g from the four flat request fields", async () => {
      repository.createCustomFood.mockResolvedValue(customFood(viewer.id));

      await service.createCustomFood(viewer, {
        name: "Protein pancakes",
        category: "grains",
        kcalPer100g: 210,
        proteinPer100g: 12,
        carbsPer100g: 28,
        fatPer100g: 5,
      });

      expect(repository.createCustomFood).toHaveBeenCalledWith(viewer.id, {
        name: "Protein pancakes",
        category: "grains",
        macrosPer100g: { kcal: 210, protein: 12, carbs: 28, fat: 5 },
        servings: [],
      });
    });

    it("404s when the repository reports the food was not owned by the caller", async () => {
      repository.softDeleteCustomFood.mockResolvedValue(false);

      await expect(service.deleteCustomFood(viewer, "id")).rejects.toThrow(NotFoundException);
    });
  });

  describe("macro goals", () => {
    it("404s when no goals have ever been saved -- never a fabricated default", async () => {
      repository.getMacroGoals.mockResolvedValue(null);

      await expect(service.getMacroGoals(viewer)).rejects.toThrow(NotFoundException);
    });

    it("returns the saved goals when present", async () => {
      repository.getMacroGoals.mockResolvedValue({ kcal: 2400, protein: 180, carbs: 240, fat: 80 });

      await expect(service.getMacroGoals(viewer)).resolves.toEqual({ kcal: 2400, protein: 180, carbs: 240, fat: 80 });
    });

    it("upserts on set", async () => {
      repository.setMacroGoals.mockResolvedValue({ kcal: 2000, protein: 150, carbs: 200, fat: 70 });

      const result = await service.setMacroGoals(viewer, { kcal: 2000, protein: 150, carbs: 200, fat: 70 });

      expect(repository.setMacroGoals).toHaveBeenCalledWith(viewer.id, { kcal: 2000, protein: 150, carbs: 200, fat: 70 });
      expect(result).toEqual({ kcal: 2000, protein: 150, carbs: 200, fat: 70 });
    });
  });

  describe("saved meals", () => {
    it("lists the caller's own saved meals", async () => {
      repository.listSavedMeals.mockResolvedValue([savedMeal()]);

      const result = await service.listSavedMeals(viewer);

      expect(result.items).toEqual([{ id: savedMeal().id, name: savedMeal().name, items: savedMeal().items }]);
    });

    it("404s deleting a saved meal the repository reports as not owned", async () => {
      repository.deleteSavedMeal.mockResolvedValue(false);

      await expect(service.deleteSavedMeal(viewer, "id")).rejects.toThrow(NotFoundException);
    });
  });

  describe("logFood", () => {
    it("looks up the food, then forwards exactly the five allowed fields -- never a macro value", async () => {
      repository.findFoodById.mockResolvedValue(catalogueFood());
      repository.logEntry.mockResolvedValue(logEntry());

      await service.logFood(viewer, {
        foodId: catalogueFood().id,
        slot: "breakfast",
        loggedDate: "2026-08-31",
        servingLabel: "1 medium",
        grams: 118,
      });

      expect(repository.logEntry).toHaveBeenCalledWith(viewer.id, {
        foodId: catalogueFood().id,
        slot: "breakfast",
        loggedDate: "2026-08-31",
        servingLabel: "1 medium",
        grams: 118,
      });
    });

    it("404s logging against another user's custom food", async () => {
      repository.findFoodById.mockResolvedValue(customFood(stranger.id));

      await expect(
        service.logFood(viewer, {
          foodId: customFood(stranger.id).id,
          slot: "lunch",
          loggedDate: "2026-08-31",
          servingLabel: "1 serving",
          grams: 100,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(repository.logEntry).not.toHaveBeenCalled();
    });

    it("404s logging against an id that does not exist", async () => {
      repository.findFoodById.mockResolvedValue(null);

      await expect(
        service.logFood(viewer, {
          foodId: "nope",
          slot: "lunch",
          loggedDate: "2026-08-31",
          servingLabel: "1 serving",
          grams: 100,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("logSavedMeal", () => {
    it("404s when the saved meal id does not belong to the caller, without calling the repository's log step", async () => {
      repository.listSavedMeals.mockResolvedValue([savedMeal({ id: "some-other-id" })]);

      await expect(
        service.logSavedMeal(viewer, { savedMealId: "not-mine", slot: "dinner", loggedDate: "2026-08-31" }),
      ).rejects.toThrow(NotFoundException);
      expect(repository.logSavedMeal).not.toHaveBeenCalled();
    });

    it("logs every item once ownership is confirmed", async () => {
      repository.listSavedMeals.mockResolvedValue([savedMeal()]);
      repository.logSavedMeal.mockResolvedValue([
        logEntry({ groupId: "group-1" }),
        logEntry({ id: "another", groupId: "group-1" }),
      ]);

      const result = await service.logSavedMeal(viewer, {
        savedMealId: savedMeal().id,
        slot: "dinner",
        loggedDate: "2026-08-31",
      });

      expect(repository.logSavedMeal).toHaveBeenCalledWith(viewer.id, savedMeal().id, "dinner", "2026-08-31");
      expect(result.items).toHaveLength(2);
    });
  });

  describe("deleteLogEntry / deleteLogGroup", () => {
    it("404s deleting an entry the repository reports as not owned", async () => {
      repository.deleteLogEntry.mockResolvedValue(false);

      await expect(service.deleteLogEntry(viewer, "id")).rejects.toThrow(NotFoundException);
    });

    it("404s deleting a group with zero matching rows", async () => {
      repository.deleteLogGroup.mockResolvedValue(0);

      await expect(service.deleteLogGroup(viewer, "group-id")).rejects.toThrow(NotFoundException);
    });

    it("succeeds deleting a group with at least one matching row", async () => {
      repository.deleteLogGroup.mockResolvedValue(2);

      await expect(service.deleteLogGroup(viewer, "group-id")).resolves.toBeUndefined();
    });
  });
});
