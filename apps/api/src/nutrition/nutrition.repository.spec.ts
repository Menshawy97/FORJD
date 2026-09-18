import { ConflictException } from "@nestjs/common";
import { Food } from "@forjd/domain";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray, sql, SQL } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import {
  foods,
  macroGoals,
  nutritionLogEntries,
  savedMeals,
  savedMealItems,
} from "../database/schema/nutrition.schema";
import { goals } from "../database/schema/goals.schema";
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

    it("rejects a duplicate name (case-insensitive) for the same owner -- the duplicate-cards bug found live on a device", async () => {
      const userId = await makeUser("saved-meal-dup");
      const name = `Breakfast — usual ${randomUUID()}`;
      const first = await repository.createSavedMeal(userId, name, []);
      createdSavedMealIds.push(first.id);

      await expect(repository.createSavedMeal(userId, name.toUpperCase(), [])).rejects.toThrow(
        ConflictException,
      );
    });

    it("allows two different owners to use the same meal name", async () => {
      const ownerA = await makeUser("saved-meal-dup-a");
      const ownerB = await makeUser("saved-meal-dup-b");
      const name = `Shared Name ${randomUUID()}`;
      const mealA = await repository.createSavedMeal(ownerA, name, []);
      createdSavedMealIds.push(mealA.id);

      const mealB = await repository.createSavedMeal(ownerB, name, []);
      createdSavedMealIds.push(mealB.id);

      expect(mealB.name).toBe(name);
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

    it("logs a saved meal's items as one group sharing a groupId, snapshotting the meal's name as groupName", async () => {
      const userId = await makeUser("log-group");
      const food = await repository.createCatalogueFood(catalogueInput(`log-group-${randomUUID()}`));
      createdFoodIds.push(food.id);
      const meal = await repository.createSavedMeal(userId, `Group Meal ${randomUUID()}`, [
        { foodId: food.id, servingLabel: "100 g", grams: 100 },
      ]);

      const entries = await repository.logSavedMeal(userId, meal.id, "lunch", "2026-08-31", meal.name);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.groupId).not.toBeNull();
      expect(entries[0]?.slot).toBe("lunch");
      expect(entries[0]?.groupName).toBe(meal.name);
    });

    it("an individually logged entry has a null groupName, same as groupId", async () => {
      const userId = await makeUser("log-single-groupname");
      const food = await repository.createCatalogueFood(catalogueInput(`log-single-gn-${randomUUID()}`));
      createdFoodIds.push(food.id);

      const entry = await repository.logEntry(userId, {
        foodId: food.id,
        slot: "snack",
        loggedDate: "2026-08-31",
        servingLabel: "100 g",
        grams: 100,
      });

      expect(entry.groupName).toBeNull();
    });

    it("renaming a saved meal after logging it does not rewrite the already-logged groupName", async () => {
      const userId = await makeUser("log-group-rename");
      const food = await repository.createCatalogueFood(catalogueInput(`log-group-rename-${randomUUID()}`));
      createdFoodIds.push(food.id);
      const originalName = `Original Name ${randomUUID()}`;
      const meal = await repository.createSavedMeal(userId, originalName, [
        { foodId: food.id, servingLabel: "100 g", grams: 100 },
      ]);

      const entries = await repository.logSavedMeal(userId, meal.id, "dinner", "2026-08-31", meal.name);

      // The meal itself is later deleted and recreated under a new name (edit-meal.tsx's own
      // delete-then-recreate adaptation) -- the already-logged entry's groupName must not
      // change, since nothing re-reads saved_meals for it.
      await repository.deleteSavedMeal(meal.id, userId);
      const renamed = await repository.createSavedMeal(userId, `Renamed ${randomUUID()}`, []);
      createdSavedMealIds.push(renamed.id);

      expect(entries[0]?.groupName).toBe(originalName);
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

  /**
   * R28: the plan's own scope -- missing foreign-key indexes on `nutrition_log_entries(food_id)`,
   * `goals(user_id)`, and `saved_meal_items(food_id)` (migration `0018_add-nutrition-goals-fk-
   * indexes.sql`), plus batching the food-search and saved-meals N+1s in `nutrition.repository.ts`.
   *
   * Seeds a few thousand rows per table so the target `food_id`/`user_id` is selective enough
   * (a handful of matches out of thousands) that Postgres's own cost-based planner -- not a
   * forced `enable_seqscan = off` -- prefers an index scan once the index exists. `ANALYZE` runs
   * after each bulk insert so the planner's row-count estimates reflect the seeded data.
   */
  describe("R28: FK indexes and N+1 batching", () => {
    /** Bulk-inserts minimal catalogue foods directly (bypassing createCatalogueFood's per-row servings round trip) purely as FK targets for the seeded rows below. */
    const seedBulkFoods = async (count: number, label: string): Promise<string[]> => {
      const rows = Array.from({ length: count }, (_, index) => ({
        ownerUserId: null,
        name: `R28 Bulk Food ${label} ${index} ${randomUUID()}`,
        category: "snacks" as const,
        kcalPer100g: "10",
        proteinPer100g: "1",
        carbsPer100g: "1",
        fatPer100g: "1",
        source: null,
        sourceId: null,
      }));
      const inserted = await db.insert(foods).values(rows).returning({ id: foods.id });
      const ids = inserted.map((row) => row.id);
      createdFoodIds.push(...ids);
      return ids;
    };

    /** Runs `EXPLAIN` and concatenates every `QUERY PLAN` line into one string. */
    const explainPlan = async (query: SQL): Promise<string> => {
      const result = await db.execute(sql`EXPLAIN ${query}`);
      return (result.rows as Array<{ "QUERY PLAN": string }>).map((row) => row["QUERY PLAN"]).join("\n");
    };

    it("nutrition_log_entries(food_id): Postgres uses nutrition_log_entries_food_idx, not a sequential scan, for a selective food_id lookup", async () => {
      const userId = await makeUser("r28-log-explain");
      const foodIds = await seedBulkFoods(60, "log-explain");
      const targetFoodId = foodIds[0];
      if (!targetFoodId) throw new Error("seedBulkFoods returned no ids");

      // 60 foods x 60 entries each = 3600 rows, ~1.7% of which match the target food_id --
      // selective enough that a cost-based planner with the index available will use it.
      const rows = foodIds.flatMap((foodId) =>
        Array.from({ length: 60 }, () => ({
          userId,
          foodId,
          loggedDate: "2026-08-30",
          slot: "snack",
          servingLabel: "100 g",
          grams: "100",
          kcal: "10",
          protein: "1",
          carbs: "1",
          fat: "1",
          groupId: null,
        })),
      );
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(nutritionLogEntries).values(rows.slice(i, i + 500));
      }
      await db.execute(sql`ANALYZE nutrition_log_entries`);

      const plan = await explainPlan(
        sql`SELECT id FROM nutrition_log_entries WHERE food_id = ${targetFoodId}`,
      );

      expect(plan).toContain("nutrition_log_entries_food_idx");
      expect(plan).not.toContain("Seq Scan on nutrition_log_entries");
    }, 30000);

    it("goals(user_id): Postgres uses goals_user_id_idx, not a sequential scan, for a selective user_id lookup", async () => {
      const targetUserId = await makeUser("r28-goals-explain-target");
      const otherUsers = await Promise.all(
        Array.from({ length: 40 }, (_, index) => makeUser(`r28-goals-explain-other-${index}`)),
      );

      // 40 other users x 60 goals each, plus the target's own single goal -- the target is a
      // 1-in-2401 match.
      const rows = otherUsers.flatMap((userId) =>
        Array.from({ length: 60 }, () => ({
          userId,
          type: "weight",
          status: "active",
        })),
      );
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(goals).values(rows.slice(i, i + 500));
      }
      await db.insert(goals).values({ userId: targetUserId, type: "weight", status: "active" });
      await db.execute(sql`ANALYZE goals`);

      const plan = await explainPlan(sql`SELECT id FROM goals WHERE user_id = ${targetUserId}`);

      expect(plan).toContain("goals_user_id_idx");
      expect(plan).not.toContain("Seq Scan on goals");
    }, 30000);

    it("saved_meal_items(food_id): Postgres uses saved_meal_items_food_idx, not a sequential scan, for a selective food_id lookup", async () => {
      const userId = await makeUser("r28-smi-explain");
      const foodIds = await seedBulkFoods(50, "smi-explain");
      const targetFoodId = foodIds[0];
      if (!targetFoodId) throw new Error("seedBulkFoods returned no ids");

      const meal = await repository.createSavedMeal(userId, `R28 SMI Explain ${randomUUID()}`, []);
      createdSavedMealIds.push(meal.id);

      const rows = foodIds.flatMap((foodId, foodIndex) =>
        Array.from({ length: 50 }, (_, itemIndex) => ({
          savedMealId: meal.id,
          foodId,
          servingLabel: "100 g",
          grams: "100",
          sortOrder: foodIndex * 50 + itemIndex,
        })),
      );
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(savedMealItems).values(rows.slice(i, i + 500));
      }
      await db.execute(sql`ANALYZE saved_meal_items`);

      const plan = await explainPlan(sql`SELECT id FROM saved_meal_items WHERE food_id = ${targetFoodId}`);

      expect(plan).toContain("saved_meal_items_food_idx");
      expect(plan).not.toContain("Seq Scan on saved_meal_items");
    }, 30000);

    it("searchFoods batches its servings lookup into one query regardless of result count (the food-search N+1)", async () => {
      const viewer = await makeUser("r28-search-n1");
      const unique = randomUUID().replace(/-/g, "");
      const created = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          repository.createCatalogueFood(catalogueInput(`r28-search-n1-${unique}-${index}`)),
        ),
      );
      createdFoodIds.push(...created.map((food: Food) => food.id));

      const querySpy = jest.spyOn(pool, "query");
      const results = await repository.searchFoods(viewer, `Test Banana r28-search-n1-${unique}`, 20);
      const callCount = querySpy.mock.calls.length;
      querySpy.mockRestore();

      expect(results.length).toBeGreaterThanOrEqual(8);
      // One query for the food rows, one batched `IN (...)` query for every result's servings --
      // never N+1 (a query per result row). A generous upper bound (not `toBe(2)`) keeps this
      // resilient to an unrelated extra round trip, while still catching the O(n) shape an N+1
      // regression would produce (10 results would need 11 calls under the old per-row loop).
      expect(callCount).toBeLessThanOrEqual(4);
    });

    it("listSavedMeals batches its items lookup into one query regardless of meal count (the saved-meals N+1)", async () => {
      const userId = await makeUser("r28-savedmeals-n1");
      const food = await repository.createCatalogueFood(catalogueInput(`r28-savedmeals-n1-${randomUUID()}`));
      createdFoodIds.push(food.id);

      const meals = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          repository.createSavedMeal(userId, `R28 N1 Meal ${index} ${randomUUID()}`, [
            { foodId: food.id, servingLabel: "100 g", grams: 100 },
          ]),
        ),
      );
      createdSavedMealIds.push(...meals.map((meal) => meal.id));

      const querySpy = jest.spyOn(pool, "query");
      const list = await repository.listSavedMeals(userId);
      const callCount = querySpy.mock.calls.length;
      querySpy.mockRestore();

      expect(list.length).toBeGreaterThanOrEqual(8);
      // One query for the meal rows, one batched `IN (...)` query for every meal's items --
      // never N+1. Same generous bound rationale as the searchFoods test above.
      expect(callCount).toBeLessThanOrEqual(4);
    });

    it("timing: listSavedMeals stays fast against a seeded set of meals -- a per-meal round trip would scale linearly with meal count", async () => {
      const userId = await makeUser("r28-savedmeals-timing");
      const food = await repository.createCatalogueFood(
        catalogueInput(`r28-savedmeals-timing-${randomUUID()}`),
      );
      createdFoodIds.push(food.id);

      const mealCount = 100;
      for (let i = 0; i < mealCount; i += 20) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(20, mealCount - i) }, (_, offset) =>
            repository.createSavedMeal(userId, `R28 Timing Meal ${i + offset} ${randomUUID()}`, [
              { foodId: food.id, servingLabel: "100 g", grams: 100 },
            ]),
          ),
        );
        createdSavedMealIds.push(...batch.map((meal) => meal.id));
      }

      const start = Date.now();
      const list = await repository.listSavedMeals(userId);
      const elapsedMs = Date.now() - start;

      expect(list.length).toBeGreaterThanOrEqual(mealCount);
      // Two round trips' worth of latency, not `mealCount` of them -- generous even under the
      // shared-machine contention this repo's own test-running notes call out.
      expect(elapsedMs).toBeLessThan(2000);
    }, 30000);

    it("timing: searchFoods stays fast against a seeded set of matching foods -- a per-result round trip would scale linearly with result count", async () => {
      const viewer = await makeUser("r28-search-timing");
      const unique = randomUUID().replace(/-/g, "");
      const created = await Promise.all(
        Array.from({ length: 50 }, (_, index) =>
          repository.createCatalogueFood(catalogueInput(`r28-search-timing-${unique}-${index}`)),
        ),
      );
      createdFoodIds.push(...created.map((food: Food) => food.id));

      const start = Date.now();
      const results = await repository.searchFoods(viewer, `Test Banana r28-search-timing-${unique}`, 50);
      const elapsedMs = Date.now() - start;

      expect(results.length).toBeGreaterThanOrEqual(50);
      expect(elapsedMs).toBeLessThan(2000);
    }, 30000);
  });

  describe("pruneCatalogueFoods", () => {
    // A unique `source` per test keeps every prune away from the real usda_fdc catalogue rows that
    // share this database -- the method's whole contract is "rows of THIS source not in THIS list".
    const seed = async (source: string, sourceIds: string[]): Promise<Map<string, string>> => {
      await repository.bulkUpsertCatalogueFoods(sourceIds.map((id) => ({ ...catalogueInput(id), source })));
      const rows = await db.select().from(foods).where(inArray(foods.sourceId, sourceIds));
      createdFoodIds.push(...rows.map((row) => row.id));
      return new Map(rows.filter((row) => row.source === source).map((row) => [row.sourceId ?? "", row.id]));
    };

    const rowById = async (id: string) => (await db.select().from(foods).where(inArray(foods.id, [id])))[0];

    it("hard-deletes an unreferenced catalogue food that is absent from the keep list, with its servings", async () => {
      const source = `prune-test-${randomUUID()}`;
      const ids = await seed(source, ["keep", "drop"]);

      const result = await repository.pruneCatalogueFoods(source, ["keep"]);

      expect(result).toEqual({ deleted: 1, softDeleted: 0 });
      expect(await rowById(ids.get("drop") ?? "")).toBeUndefined();
      expect(await rowById(ids.get("keep") ?? "")).toBeDefined();
    });

    it("soft-deletes rather than deletes a food that a log entry references, hiding it from search", async () => {
      const source = `prune-test-${randomUUID()}`;
      const ids = await seed(source, ["keep", "logged"]);
      const loggedId = ids.get("logged") ?? "";
      const userId = await makeUser("prune-logged");
      await repository.logEntry(userId, {
        foodId: loggedId,
        slot: "breakfast",
        loggedDate: "2026-09-01",
        servingLabel: "100 g",
        grams: 100,
      });

      const result = await repository.pruneCatalogueFoods(source, ["keep"]);

      expect(result).toEqual({ deleted: 0, softDeleted: 1 });
      expect((await rowById(loggedId))?.deletedAt).not.toBeNull();
      expect(await repository.findFoodById(loggedId)).toBeNull();
      const found = await repository.searchFoods(userId, "Test Banana logged", 50);
      expect(found.map((food) => food.id)).not.toContain(loggedId);
    });

    it("soft-deletes a food that a saved meal references, leaving the saved meal's item intact", async () => {
      const source = `prune-test-${randomUUID()}`;
      const ids = await seed(source, ["keep", "in-meal"]);
      const userId = await makeUser("prune-meal");
      const meal = await repository.createSavedMeal(userId, `Prune meal ${randomUUID()}`, [
        { foodId: ids.get("in-meal") ?? "", servingLabel: "100 g", grams: 100 },
      ]);
      createdSavedMealIds.push(meal.id);

      const result = await repository.pruneCatalogueFoods(source, ["keep"]);

      expect(result).toEqual({ deleted: 0, softDeleted: 1 });
      const items = await db.select().from(savedMealItems).where(inArray(savedMealItems.savedMealId, [meal.id]));
      expect(items).toHaveLength(1);
    });

    it("never touches another source or a user's custom food", async () => {
      const source = `prune-test-${randomUUID()}`;
      const otherSource = `prune-test-other-${randomUUID()}`;
      await seed(source, ["keep"]);
      const other = await seed(otherSource, ["other-food"]);
      const userId = await makeUser("prune-custom");
      const custom = await repository.createCustomFood(userId, {
        name: `Custom ${randomUUID()}`,
        category: "snacks",
        macrosPer100g: { kcal: 100, protein: 1, carbs: 1, fat: 1 },
        servings: [],
      });
      createdFoodIds.push(custom.id);

      const result = await repository.pruneCatalogueFoods(source, ["keep"]);

      expect(result).toEqual({ deleted: 0, softDeleted: 0 });
      expect(await rowById(other.get("other-food") ?? "")).toBeDefined();
      expect(await rowById(custom.id)).toBeDefined();
    });

    it("is idempotent -- a second run finds nothing left to prune", async () => {
      const source = `prune-test-${randomUUID()}`;
      await seed(source, ["keep", "drop"]);

      await repository.pruneCatalogueFoods(source, ["keep"]);
      const second = await repository.pruneCatalogueFoods(source, ["keep"]);

      expect(second).toEqual({ deleted: 0, softDeleted: 0 });
    });

    it("restores a soft-deleted food when it reappears in a later load", async () => {
      const source = `prune-test-${randomUUID()}`;
      const ids = await seed(source, ["keep", "logged"]);
      const loggedId = ids.get("logged") ?? "";
      const userId = await makeUser("prune-restore");
      await repository.logEntry(userId, {
        foodId: loggedId,
        slot: "lunch",
        loggedDate: "2026-09-01",
        servingLabel: "100 g",
        grams: 100,
      });
      await repository.pruneCatalogueFoods(source, ["keep"]);
      expect(await repository.findFoodById(loggedId)).toBeNull();

      await repository.bulkUpsertCatalogueFoods([{ ...catalogueInput("logged"), source }]);

      expect((await repository.findFoodById(loggedId))?.id).toBe(loggedId);
    });
  });

  describe("countCatalogueFoods", () => {
    it("counts only the active catalogue foods of that source", async () => {
      const source = `prune-test-${randomUUID()}`;
      await repository.bulkUpsertCatalogueFoods(["a", "b", "c"].map((id) => ({ ...catalogueInput(id), source })));
      const rows = await db.select().from(foods).where(inArray(foods.sourceId, ["a", "b", "c"]));
      createdFoodIds.push(...rows.map((row) => row.id));

      expect(await repository.countCatalogueFoods(source)).toBe(3);

      await repository.pruneCatalogueFoods(source, ["a"]);

      expect(await repository.countCatalogueFoods(source)).toBe(1);
    });
  });
});
