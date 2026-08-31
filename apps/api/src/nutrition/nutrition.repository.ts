import { ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  Food,
  FOOD_CATEGORIES,
  FoodCategory,
  MacroTotals,
  MealSlot,
  Serving,
} from "@forjd/domain";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { Database, DRIZZLE } from "../database/database.module";
import {
  foods,
  foodServings,
  FoodRow,
  macroGoals,
  nutritionLogEntries,
  NutritionLogEntryRow,
  savedMeals,
  savedMealItems,
  SavedMealRow,
} from "../database/schema/nutrition.schema";

/**
 * Postgres unique_violation, mirroring `exercises.repository.ts`'s own helper -- checks both
 * the top-level `code` (a raw pg error) and `cause.code` (drizzle-orm wraps every query
 * failure in a `DrizzleQueryError` with the real pg error attached as `.cause`).
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

/** Narrows a `text` column back to the known vocabulary, defaulting to the first member -- see `keepKnownNullable` in exercises.repository.ts for the same pattern. */
function keepCategory(value: string): FoodCategory {
  return (FOOD_CATEGORIES as readonly string[]).includes(value)
    ? (value as FoodCategory)
    : "snacks";
}

export interface FoodServingInput {
  label: string;
  grams: number;
}

export interface CreateCatalogueFoodInput {
  source: string;
  sourceId: string;
  name: string;
  category: FoodCategory;
  macrosPer100g: MacroTotals;
  servings: FoodServingInput[];
}

export interface CreateCustomFoodInput {
  name: string;
  category: FoodCategory;
  macrosPer100g: MacroTotals;
  servings: FoodServingInput[];
}

export interface SavedMealItemInput {
  foodId: string;
  servingLabel: string;
  grams: number;
}

export interface SavedMealWithItems {
  id: string;
  userId: string;
  name: string;
  items: Array<{ foodId: string; servingLabel: string; grams: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface LogEntryInput {
  foodId: string;
  slot: MealSlot;
  /** `YYYY-MM-DD`, the client's own local calendar day -- see nutrition.schema.ts's docblock on nutritionLogEntries for why this is never server-derived. */
  loggedDate: string;
  servingLabel: string;
  grams: number;
}

export interface NutritionLogEntry {
  id: string;
  userId: string;
  foodId: string;
  loggedDate: string;
  slot: MealSlot;
  servingLabel: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  groupId: string | null;
  createdAt: Date;
}

/**
 * Data access for foods (catalogue + custom), macro goals, saved meals, and the daily log
 * (ADR-023, Phase 2.5). Never throws NotFoundException and never distinguishes "no such row"
 * from "not yours" for a food or log entry -- both return `null`/`false`, the same
 * repo-returns-null / service-throws-404 split `ExercisesRepository`'s own docblock states.
 */
@Injectable()
export class NutritionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // ---------------------------------------------------------------------------------------
  // Foods
  // ---------------------------------------------------------------------------------------

  /** Upsert on (source, sourceId), matching `upsertCatalogueExercise`'s own pattern exactly. */
  async createCatalogueFood(input: CreateCatalogueFoodInput): Promise<Food> {
    const [row] = await this.db
      .insert(foods)
      .values({
        ownerUserId: null,
        name: input.name,
        category: input.category,
        kcalPer100g: input.macrosPer100g.kcal.toString(),
        proteinPer100g: input.macrosPer100g.protein.toString(),
        carbsPer100g: input.macrosPer100g.carbs.toString(),
        fatPer100g: input.macrosPer100g.fat.toString(),
        source: input.source,
        sourceId: input.sourceId,
      })
      .onConflictDoUpdate({
        target: [foods.source, foods.sourceId],
        targetWhere: isNull(foods.ownerUserId),
        set: {
          name: input.name,
          category: input.category,
          kcalPer100g: input.macrosPer100g.kcal.toString(),
          proteinPer100g: input.macrosPer100g.protein.toString(),
          carbsPer100g: input.macrosPer100g.carbs.toString(),
          fatPer100g: input.macrosPer100g.fat.toString(),
          updatedAt: sql`now()`,
        },
      })
      .returning();

    if (!row) throw new Error("createCatalogueFood: insert returned no row");
    await this.replaceServings(row.id, input.servings);
    return this.toFood(row, input.servings.map((serving) => ({ ...serving })));
  }

  async createCustomFood(ownerUserId: string, input: CreateCustomFoodInput): Promise<Food> {
    try {
      const [row] = await this.db
        .insert(foods)
        .values({
          ownerUserId,
          name: input.name,
          category: input.category,
          kcalPer100g: input.macrosPer100g.kcal.toString(),
          proteinPer100g: input.macrosPer100g.protein.toString(),
          carbsPer100g: input.macrosPer100g.carbs.toString(),
          fatPer100g: input.macrosPer100g.fat.toString(),
          source: null,
          sourceId: null,
        })
        .returning();

      if (!row) throw new Error("createCustomFood: insert returned no row");
      await this.replaceServings(row.id, input.servings);
      return this.toFood(row, input.servings.map((serving) => ({ ...serving })));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("A food with that name already exists");
      }
      throw error;
    }
  }

  async findFoodById(id: string): Promise<Food | null> {
    const [row] = await this.db
      .select()
      .from(foods)
      .where(and(eq(foods.id, id), isNull(foods.deletedAt)));
    if (!row) return null;
    const servings = await this.listServings(id);
    return this.toFood(row, servings);
  }

  /**
   * Full-text OR trigram match on `name`, mirroring `searchCondition` in
   * `exercises.repository.ts` exactly -- FTS matches whole lexemes with stemming, trigram
   * matches partial words while the user is still typing.
   *
   * **Scoped to `viewerUserId`'s own custom foods, plus every catalogue row.** Without this,
   * any signed-in user's search would surface every *other* user's custom foods too --
   * `foods` has no RLS of its own (rule 12: authorization lives here, not only in SQL), and a
   * food's name is not something one user should see a stranger typed.
   *
   * `category` filters in the same query rather than being applied afterward by the caller --
   * filtering post-`limit` would under-return (a filtered-out row still consumed one of the
   * `limit` slots), the same class of bug keyset pagination's own index exists to avoid.
   */
  async searchFoods(viewerUserId: string, term: string, limit: number, category?: FoodCategory): Promise<Food[]> {
    const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const rows = await this.db
      .select()
      .from(foods)
      .where(
        and(
          isNull(foods.deletedAt),
          or(isNull(foods.ownerUserId), eq(foods.ownerUserId, viewerUserId)),
          category ? eq(foods.category, category) : undefined,
          sql`(
            ${foods}.search_vector @@ plainto_tsquery('english', ${term})
            or ${foods.name} ilike ${pattern}
          )`,
        ),
      )
      .orderBy(foods.name, foods.id)
      .limit(limit);

    const results: Food[] = [];
    for (const row of rows) {
      results.push(this.toFood(row, await this.listServings(row.id)));
    }
    return results;
  }

  /** Soft delete only -- log entries reference foods by id (mirrors exercises.repository.ts's own reasoning). */
  async softDeleteCustomFood(id: string, ownerUserId: string): Promise<boolean> {
    const rows = await this.db
      .update(foods)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(foods.id, id), eq(foods.ownerUserId, ownerUserId), isNull(foods.deletedAt)))
      .returning({ id: foods.id });
    return rows.length > 0;
  }

  private async replaceServings(foodId: string, servings: FoodServingInput[]): Promise<void> {
    await this.db.delete(foodServings).where(eq(foodServings.foodId, foodId));
    if (servings.length === 0) return;
    await this.db.insert(foodServings).values(
      servings.map((serving, index) => ({
        foodId,
        label: serving.label,
        grams: serving.grams.toString(),
        sortOrder: index,
      })),
    );
  }

  private async listServings(foodId: string): Promise<Serving[]> {
    const rows = await this.db
      .select()
      .from(foodServings)
      .where(eq(foodServings.foodId, foodId))
      .orderBy(foodServings.sortOrder);
    return rows.map((row) => ({ label: row.label, grams: Number(row.grams) }));
  }

  private toFood(row: FoodRow, servings: Serving[]): Food {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      name: row.name,
      category: keepCategory(row.category),
      macrosPer100g: {
        kcal: Number(row.kcalPer100g),
        protein: Number(row.proteinPer100g),
        carbs: Number(row.carbsPer100g),
        fat: Number(row.fatPer100g),
      },
      servings,
      source: row.source,
      sourceId: row.sourceId,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Macro goals
  // ---------------------------------------------------------------------------------------

  /** `null` before the user has ever saved goals -- see nutrition.schema.ts's docblock on macroGoals for why there is no seeded default. */
  async getMacroGoals(userId: string): Promise<MacroTotals | null> {
    const [row] = await this.db.select().from(macroGoals).where(eq(macroGoals.userId, userId));
    return row ? this.toMacroTotals(row) : null;
  }

  async setMacroGoals(userId: string, goals: MacroTotals): Promise<MacroTotals> {
    const [row] = await this.db
      .insert(macroGoals)
      .values({
        userId,
        kcal: goals.kcal.toString(),
        protein: goals.protein.toString(),
        carbs: goals.carbs.toString(),
        fat: goals.fat.toString(),
      })
      .onConflictDoUpdate({
        target: macroGoals.userId,
        set: {
          kcal: goals.kcal.toString(),
          protein: goals.protein.toString(),
          carbs: goals.carbs.toString(),
          fat: goals.fat.toString(),
          updatedAt: sql`now()`,
        },
      })
      .returning();

    if (!row) throw new Error("setMacroGoals: insert returned no row");
    return this.toMacroTotals(row);
  }

  private toMacroTotals(row: { kcal: string; protein: string; carbs: string; fat: string }): MacroTotals {
    return {
      kcal: Number(row.kcal),
      protein: Number(row.protein),
      carbs: Number(row.carbs),
      fat: Number(row.fat),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Saved meals
  // ---------------------------------------------------------------------------------------

  async createSavedMeal(
    userId: string,
    name: string,
    items: SavedMealItemInput[],
  ): Promise<SavedMealWithItems> {
    const [row] = await this.db.insert(savedMeals).values({ userId, name }).returning();
    if (!row) throw new Error("createSavedMeal: insert returned no row");

    if (items.length > 0) {
      await this.db.insert(savedMealItems).values(
        items.map((item, index) => ({
          savedMealId: row.id,
          foodId: item.foodId,
          servingLabel: item.servingLabel,
          grams: item.grams.toString(),
          sortOrder: index,
        })),
      );
    }

    return this.toSavedMealWithItems(row, items);
  }

  async listSavedMeals(userId: string): Promise<SavedMealWithItems[]> {
    const mealRows = await this.db
      .select()
      .from(savedMeals)
      .where(eq(savedMeals.userId, userId))
      .orderBy(savedMeals.createdAt);

    const results: SavedMealWithItems[] = [];
    for (const meal of mealRows) {
      const itemRows = await this.db
        .select()
        .from(savedMealItems)
        .where(eq(savedMealItems.savedMealId, meal.id))
        .orderBy(savedMealItems.sortOrder);
      results.push(
        this.toSavedMealWithItems(
          meal,
          itemRows.map((item) => ({
            foodId: item.foodId,
            servingLabel: item.servingLabel,
            grams: Number(item.grams),
          })),
        ),
      );
    }
    return results;
  }

  async deleteSavedMeal(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(savedMeals)
      .where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)))
      .returning({ id: savedMeals.id });
    return rows.length > 0;
  }

  private toSavedMealWithItems(
    row: SavedMealRow,
    items: Array<{ foodId: string; servingLabel: string; grams: number }>,
  ): SavedMealWithItems {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      items,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------------------
  // The daily log
  // ---------------------------------------------------------------------------------------

  /**
   * Computes the macro snapshot from the food's current per-100g values and the logged grams,
   * then stores that snapshot -- never a live lookup at read time. See
   * nutrition.schema.ts's docblock on `nutritionLogEntries` for why: a later edit to a food
   * must not silently rewrite what a user is told they ate on a past day.
   */
  async logEntry(userId: string, input: LogEntryInput): Promise<NutritionLogEntry> {
    const food = await this.mustFindFoodRow(input.foodId);
    const macros = this.scaleMacros(food, input.grams);

    const [row] = await this.db
      .insert(nutritionLogEntries)
      .values({
        userId,
        foodId: input.foodId,
        loggedDate: input.loggedDate,
        slot: input.slot,
        servingLabel: input.servingLabel,
        grams: input.grams.toString(),
        kcal: macros.kcal.toString(),
        protein: macros.protein.toString(),
        carbs: macros.carbs.toString(),
        fat: macros.fat.toString(),
        groupId: null,
      })
      .returning();

    if (!row) throw new Error("logEntry: insert returned no row");
    return this.toLogEntry(row);
  }

  /**
   * Copies a saved meal's items into the log, sharing one `groupId` so the dashboard can
   * collapse and delete them as one (`nutrition-plan.md`'s locked decisions). A copy, not a
   * reference -- editing the saved meal afterwards never rewrites this day's history.
   */
  async logSavedMeal(
    userId: string,
    savedMealId: string,
    slot: MealSlot,
    loggedDate: string,
  ): Promise<NutritionLogEntry[]> {
    const itemRows = await this.db
      .select()
      .from(savedMealItems)
      .where(eq(savedMealItems.savedMealId, savedMealId))
      .orderBy(savedMealItems.sortOrder);

    if (itemRows.length === 0) return [];

    const groupId = crypto.randomUUID();
    const values: (typeof nutritionLogEntries.$inferInsert)[] = [];
    for (const item of itemRows) {
      const food = await this.mustFindFoodRow(item.foodId);
      const grams = Number(item.grams);
      const macros = this.scaleMacros(food, grams);
      values.push({
        userId,
        foodId: item.foodId,
        loggedDate,
        slot,
        servingLabel: item.servingLabel,
        grams: grams.toString(),
        kcal: macros.kcal.toString(),
        protein: macros.protein.toString(),
        carbs: macros.carbs.toString(),
        fat: macros.fat.toString(),
        groupId,
      });
    }

    const rows = await this.db.insert(nutritionLogEntries).values(values).returning();
    return rows.map((row) => this.toLogEntry(row));
  }

  async listLogForDate(userId: string, loggedDate: string): Promise<NutritionLogEntry[]> {
    const rows = await this.db
      .select()
      .from(nutritionLogEntries)
      .where(and(eq(nutritionLogEntries.userId, userId), eq(nutritionLogEntries.loggedDate, loggedDate)))
      .orderBy(nutritionLogEntries.createdAt);
    return rows.map((row) => this.toLogEntry(row));
  }

  async deleteLogEntry(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(nutritionLogEntries)
      .where(and(eq(nutritionLogEntries.id, id), eq(nutritionLogEntries.userId, userId)))
      .returning({ id: nutritionLogEntries.id });
    return rows.length > 0;
  }

  /** Deletes every entry sharing a groupId -- the "delete this saved-meal log as one" action. */
  async deleteLogGroup(groupId: string, userId: string): Promise<number> {
    const rows = await this.db
      .delete(nutritionLogEntries)
      .where(and(eq(nutritionLogEntries.groupId, groupId), eq(nutritionLogEntries.userId, userId)))
      .returning({ id: nutritionLogEntries.id });
    return rows.length;
  }

  private async mustFindFoodRow(foodId: string): Promise<FoodRow> {
    const [row] = await this.db.select().from(foods).where(eq(foods.id, foodId));
    if (!row) {
      throw new Error(`logEntry: no such food ${foodId}`);
    }
    return row;
  }

  private scaleMacros(food: FoodRow, grams: number): MacroTotals {
    const factor = grams / 100;
    return {
      kcal: Number(food.kcalPer100g) * factor,
      protein: Number(food.proteinPer100g) * factor,
      carbs: Number(food.carbsPer100g) * factor,
      fat: Number(food.fatPer100g) * factor,
    };
  }

  private toLogEntry(row: NutritionLogEntryRow): NutritionLogEntry {
    return {
      id: row.id,
      userId: row.userId,
      foodId: row.foodId,
      loggedDate: row.loggedDate,
      slot: row.slot as MealSlot,
      servingLabel: row.servingLabel,
      grams: Number(row.grams),
      kcal: Number(row.kcal),
      protein: Number(row.protein),
      carbs: Number(row.carbs),
      fat: Number(row.fat),
      groupId: row.groupId,
      createdAt: row.createdAt,
    };
  }
}
