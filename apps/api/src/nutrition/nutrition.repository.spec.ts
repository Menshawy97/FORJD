import { ConflictException } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import {
  foods,
  macroGoals,
  nutritionLogEntries,
  savedMeals,
} from "../database/schema/nutrition.schema";
import { users } from "../database/schema/users.schema";
import { NutritionRepository } from "./nutrition.repository";

/**
 * Exercised against real Postgres, not a mock -- the behaviour under test is the database's
 * own conflict resolution (partial unique indexes, ON CONFLICT, FTS/trigram search) and
 * server-computed macro snapshots, which a mock would only prove the test author's
 * assumptions about. Same rationale as ExercisesRepository.spec.ts.
 */
describe("NutritionRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: NutritionRepository;
  const createdUserIds: string[] = [];
  const createdFoodIds: string[] = [];
  const createdSavedMealIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `nutrepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    createdUserIds.push(row.id);
    return row.id;
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new NutritionRepository(db);
  });

  afterAll(async () => {
    // nutrition_log_entries.food_id is ON DELETE RESTRICT (nutrition.schema.ts's own docblock
    // explains why: a food must not vanish out from under a day's logged history) -- log
    // entries have to go before foods can be deleted, same ordering the RESTRICT itself
    // enforces in production.
    if (createdUserIds.length > 0) {
      await db.delete(nutritionLogEntries).where(inArray(nutritionLogEntries.userId, createdUserIds));
      await db.delete(macroGoals).where(inArray(macroGoals.userId, createdUserIds));
      await db.delete(savedMeals).where(inArray(savedMeals.userId, createdUserIds));
    }
    if (createdFoodIds.length > 0) {
      await db.delete(foods).where(inArray(foods.id, createdFoodIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  const catalogueInput = (sourceId: string) => ({
    source: "usda_fdc",
    sourceId,
    name: `Test Banana ${sourceId}`,
    category: "fruits" as const,
    macrosPer100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
    servings: [{ label: "1 medium (118g)", grams: 118 }, { label: "100 g", grams: 100 }],
  });

  describe("createCatalogueFood", () => {
    it("creates a catalogue food with ownerUserId null and its servings", async () => {
      const sourceId = `banana-${randomUUID()}`;
      const food = await repository.createCatalogueFood(catalogueInput(sourceId));
      createdFoodIds.push(food.id);

      expect(food.ownerUserId).toBeNull();
      expect(food.category).toBe("fruits");
      expect(food.macrosPer100g).toEqual({ kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 });
      expect(food.servings).toEqual([
        { label: "1 medium (118g)", grams: 118 },
        { label: "100 g", grams: 100 },
      ]);
    });

    it("is idempotent -- re-running against the same (source, sourceId) updates rather than duplicates", async () => {
      const sourceId = `banana-${randomUUID()}`;
      const first = await repository.createCatalogueFood(catalogueInput(sourceId));
      createdFoodIds.push(first.id);

      const second = await repository.createCatalogueFood({
        ...catalogueInput(sourceId),
        macrosPer100g: { kcal: 90, protein: 1.2, carbs: 23, fat: 0.4 },
      });

      expect(second.id).toBe(first.id);
      expect(second.macrosPer100g.kcal).toBe(90);
    });
  });

  describe("bulkUpsertCatalogueFoods", () => {
    it("creates every food in the batch with its own servings", async () => {
      const idA = `bulk-a-${randomUUID()}`;
      const idB = `bulk-b-${randomUUID()}`;

      await repository.bulkUpsertCatalogueFoods([catalogueInput(idA), catalogueInput(idB)]);

      const [foodA, foodB] = await Promise.all([
        repository.searchFoods(randomUUID(), `Test Banana ${idA}`, 1),
        repository.searchFoods(randomUUID(), `Test Banana ${idB}`, 1),
      ]);
      const a = foodA[0];
      const b = foodB[0];
      if (!a || !b) throw new Error("expected both bulk-inserted foods to be findable");
      createdFoodIds.push(a.id, b.id);

      expect(a.macrosPer100g).toEqual({ kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 });
      expect(a.servings).toEqual([
        { label: "1 medium (118g)", grams: 118 },
        { label: "100 g", grams: 100 },
      ]);
      expect(b.sourceId).toBe(idB);
    });

    it("is idempotent -- re-running the same batch updates in place rather than duplicating", async () => {
      const sourceId = `bulk-idempotent-${randomUUID()}`;

      await repository.bulkUpsertCatalogueFoods([catalogueInput(sourceId)]);
      const [firstRow] = await repository.searchFoods(randomUUID(), `Test Banana ${sourceId}`, 1);
      if (!firstRow) throw new Error("expected the first bulk upsert to be findable");
      createdFoodIds.push(firstRow.id);

      await repository.bulkUpsertCatalogueFoods([
        { ...catalogueInput(sourceId), macrosPer100g: { kcal: 95, protein: 1.5, carbs: 24, fat: 0.5 } },
      ]);

      const found = await repository.findFoodById(firstRow.id);
      expect(found?.macrosPer100g.kcal).toBe(95);
    });

    it("replaces servings entirely rather than merging old and new", async () => {
      const sourceId = `bulk-servings-${randomUUID()}`;

      await repository.bulkUpsertCatalogueFoods([catalogueInput(sourceId)]);
      const [firstRow] = await repository.searchFoods(randomUUID(), `Test Banana ${sourceId}`, 1);
      if (!firstRow) throw new Error("expected the first bulk upsert to be findable");
      createdFoodIds.push(firstRow.id);

      await repository.bulkUpsertCatalogueFoods([
        { ...catalogueInput(sourceId), servings: [{ label: "1 whole", grams: 130 }] },
      ]);

      const found = await repository.findFoodById(firstRow.id);
      expect(found?.servings).toEqual([{ label: "1 whole", grams: 130 }]);
    });

    it("does nothing for an empty batch", async () => {
      await expect(repository.bulkUpsertCatalogueFoods([])).resolves.toBeUndefined();
    });
  });

  describe("createCustomFood", () => {
    it("creates a custom food owned by the given user", async () => {
      const userId = await makeUser("owner");
      const food = await repository.createCustomFood(userId, {
        name: `My Shake ${randomUUID()}`,
        category: "beverages",
        macrosPer100g: { kcal: 120, protein: 20, carbs: 5, fat: 1 },
        servings: [{ label: "1 scoop (33g)", grams: 33 }],
      });
      createdFoodIds.push(food.id);

      expect(food.ownerUserId).toBe(userId);
      expect(food.source).toBeNull();
    });

    it("rejects a duplicate name (case-insensitive) for the same owner", async () => {
      const userId = await makeUser("dup");
      const name = `Duplicate Food ${randomUUID()}`;
      const first = await repository.createCustomFood(userId, {
        name,
        category: "snacks",
        macrosPer100g: { kcal: 100, protein: 1, carbs: 1, fat: 1 },
        servings: [],
      });
      createdFoodIds.push(first.id);

      await expect(
        repository.createCustomFood(userId, {
          name: name.toUpperCase(),
          category: "snacks",
          macrosPer100g: { kcal: 100, protein: 1, carbs: 1, fat: 1 },
          servings: [],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("findFoodById", () => {
    it("returns null for a missing food", async () => {
      expect(await repository.findFoodById(randomUUID())).toBeNull();
    });

    it("returns null for a soft-deleted custom food", async () => {
      const userId = await makeUser("deleted");
      const food = await repository.createCustomFood(userId, {
        name: `To Delete ${randomUUID()}`,
        category: "snacks",
        macrosPer100g: { kcal: 1, protein: 1, carbs: 1, fat: 1 },
        servings: [],
      });
      createdFoodIds.push(food.id);

      await repository.softDeleteCustomFood(food.id, userId);

      expect(await repository.findFoodById(food.id)).toBeNull();
    });
  });

  describe("searchFoods", () => {
    it("finds a food by full-text match on its name", async () => {
      const unique = randomUUID().replace(/-/g, "");
      const food = await repository.createCatalogueFood(catalogueInput(unique));
      createdFoodIds.push(food.id);
      const viewer = await makeUser("search-viewer");

      const results = await repository.searchFoods(viewer, `Test Banana ${unique}`, 10);

      expect(results.some((result) => result.id === food.id)).toBe(true);
    });

    it("finds the viewer's own custom food", async () => {
      const owner = await makeUser("search-own-custom");
      const unique = randomUUID().replace(/-/g, "");
      const food = await repository.createCustomFood(owner, {
        name: `My Own Snack ${unique}`,
        category: "snacks",
        macrosPer100g: { kcal: 1, protein: 1, carbs: 1, fat: 1 },
        servings: [],
      });
      createdFoodIds.push(food.id);

      const results = await repository.searchFoods(owner, `My Own Snack ${unique}`, 10);

      expect(results.some((result) => result.id === food.id)).toBe(true);
    });

    it("never returns another user's custom food -- a food's name is not something a stranger should see", async () => {
      const owner = await makeUser("search-isolation-owner");
      const stranger = await makeUser("search-isolation-stranger");
      const unique = randomUUID().replace(/-/g, "");
      const food = await repository.createCustomFood(owner, {
        name: `Private Recipe ${unique}`,
        category: "snacks",
        macrosPer100g: { kcal: 1, protein: 1, carbs: 1, fat: 1 },
        servings: [],
      });
      createdFoodIds.push(food.id);

      const results = await repository.searchFoods(stranger, `Private Recipe ${unique}`, 10);

      expect(results.some((result) => result.id === food.id)).toBe(false);
    });
  });

  describe("softDeleteCustomFood", () => {
    it("returns false for a food not owned by the caller", async () => {
      const owner = await makeUser("softdel-owner");
      const other = await makeUser("softdel-other");
      const food = await repository.createCustomFood(owner, {
        name: `Not Yours ${randomUUID()}`,
        category: "snacks",
        macrosPer100g: { kcal: 1, protein: 1, carbs: 1, fat: 1 },
        servings: [],
      });
      createdFoodIds.push(food.id);

      expect(await repository.softDeleteCustomFood(food.id, other)).toBe(false);
    });
  });

  describe("macro goals", () => {
    it("returns null before any goals are saved", async () => {
      const userId = await makeUser("goals-empty");
      expect(await repository.getMacroGoals(userId)).toBeNull();
    });

    it("upserts goals -- saving twice updates the same row", async () => {
      const userId = await makeUser("goals-upsert");
      await repository.setMacroGoals(userId, { kcal: 2400, protein: 180, carbs: 240, fat: 80 });
      const updated = await repository.setMacroGoals(userId, {
        kcal: 2200,
        protein: 170,
        carbs: 220,
        fat: 75,
      });

      expect(updated).toEqual({ kcal: 2200, protein: 170, carbs: 220, fat: 75 });
      expect(await repository.getMacroGoals(userId)).toEqual(updated);
    });
  });

  describe("saved meals", () => {
    it("creates a saved meal with its items and lists it back", async () => {
      const userId = await makeUser("saved-meal");
      const food = await repository.createCatalogueFood(catalogueInput(`sm-${randomUUID()}`));
      createdFoodIds.push(food.id);

      const meal = await repository.createSavedMeal(userId, "Breakfast Combo", [
        { foodId: food.id, servingLabel: "1 medium (118g)", grams: 118 },
      ]);
      createdSavedMealIds.push(meal.id);

      expect(meal.name).toBe("Breakfast Combo");
      expect(meal.items).toHaveLength(1);

      const list = await repository.listSavedMeals(userId);
      expect(list.some((entry) => entry.id === meal.id)).toBe(true);
    });

    it("deleteSavedMeal removes it and its items", async () => {
      const userId = await makeUser("saved-meal-delete");
      const food = await repository.createCatalogueFood(catalogueInput(`smd-${randomUUID()}`));
      createdFoodIds.push(food.id);
      const meal = await repository.createSavedMeal(userId, "To Delete", [
        { foodId: food.id, servingLabel: "100 g", grams: 100 },
      ]);

      expect(await repository.deleteSavedMeal(meal.id, userId)).toBe(true);
      expect(await repository.listSavedMeals(userId)).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ id: meal.id })]),
      );
    });
  });

  describe("the daily log", () => {
    it("logs a single entry, computing the macro snapshot from the food's per-100g values and the logged grams", async () => {
      const userId = await makeUser("log-single");
      const food = await repository.createCatalogueFood(catalogueInput(`log-${randomUUID()}`));
      createdFoodIds.push(food.id);

      const entry = await repository.logEntry(userId, {
        foodId: food.id,
        slot: "breakfast",
        loggedDate: "2026-08-31",
        servingLabel: "1 medium (118g)",
        grams: 118,
      });

      // 89 kcal/100g * 118g / 100 = 105.02
      expect(entry.kcal).toBeCloseTo(105.02, 1);
      expect(entry.groupId).toBeNull();
    });

    it("logs a saved meal's items as one group sharing a groupId", async () => {
      const userId = await makeUser("log-group");
      const food = await repository.createCatalogueFood(catalogueInput(`log-group-${randomUUID()}`));
      createdFoodIds.push(food.id);
      const meal = await repository.createSavedMeal(userId, "Group Meal", [
        { foodId: food.id, servingLabel: "100 g", grams: 100 },
      ]);

      const entries = await repository.logSavedMeal(userId, meal.id, "lunch", "2026-08-31");

      expect(entries).toHaveLength(1);
      expect(entries[0]?.groupId).not.toBeNull();
      expect(entries[0]?.slot).toBe("lunch");
    });

    it("listLogForDate returns only that user's entries for that date", async () => {
      const userId = await makeUser("log-list");
      const food = await repository.createCatalogueFood(catalogueInput(`log-list-${randomUUID()}`));
      createdFoodIds.push(food.id);
      await repository.logEntry(userId, {
        foodId: food.id,
        slot: "dinner",
        loggedDate: "2026-08-30",
        servingLabel: "100 g",
        grams: 100,
      });

      const wrongDay = await repository.listLogForDate(userId, "2026-08-29");
      const rightDay = await repository.listLogForDate(userId, "2026-08-30");

      expect(wrongDay).toHaveLength(0);
      expect(rightDay).toHaveLength(1);
    });

    it("deleteLogEntry removes only the caller's own entry", async () => {
      const owner = await makeUser("log-del-owner");
      const other = await makeUser("log-del-other");
      const food = await repository.createCatalogueFood(catalogueInput(`log-del-${randomUUID()}`));
      createdFoodIds.push(food.id);
      const entry = await repository.logEntry(owner, {
        foodId: food.id,
        slot: "snack",
        loggedDate: "2026-08-30",
        servingLabel: "100 g",
        grams: 100,
      });

      expect(await repository.deleteLogEntry(entry.id, other)).toBe(false);
      expect(await repository.deleteLogEntry(entry.id, owner)).toBe(true);
    });
  });
});
