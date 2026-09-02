import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateCustomFoodRequest,
  CreateSavedMealRequest,
  FoodListResponse,
  FoodResponse,
  FoodSearchQuery,
  LogFoodRequest,
  LogSavedMealRequest,
  MacroGoalsResponse,
  NutritionLogEntryResponse,
  NutritionLogListResponse,
  SavedMealListResponse,
  SavedMealResponse,
  SetMacroGoalsRequest,
} from "@forjd/contracts";
import { Food, MacroTotals, User } from "@forjd/domain";

import { NutritionLogEntry, NutritionRepository, SavedMealWithItems } from "./nutrition.repository";

/**
 * Policy for the nutrition vertical (Phase 2.5, ADR-023). Mirrors `ExercisesService`'s own
 * shape: the repository never distinguishes "no such row" from "not yours" (returns
 * `null`/`false`), and this class is where that becomes a **404, never 403** refusal --
 * `AthletesService`'s anti-enumeration reasoning applies just as much to a food log as to a
 * profile, since both are health data a caller should not be able to probe.
 */
@Injectable()
export class NutritionService {
  constructor(private readonly nutritionRepository: NutritionRepository) {}

  // ---------------------------------------------------------------------------------------
  // Foods
  // ---------------------------------------------------------------------------------------

  /**
   * A blank `q` browses the catalogue (respecting `category`) rather than returning nothing.
   * **Reverses Phase E's original "requires a search term" scope decision** -- that call
   * predated any real screenshot of this screen; `FORJD mobile app design/screenshots/
   * searchfoodalsoaddfood.png` (added later) shows a fully populated list with nothing typed
   * and "All" selected, which only a browsable blank-query result can produce. Confirmed with
   * the user before reversing, same as ADR-019 reversed the earlier "no handle" decision.
   */
  async searchFoods(viewer: User, query: FoodSearchQuery): Promise<FoodListResponse> {
    const results = await this.nutritionRepository.searchFoods(viewer.id, query.q ?? '', query.limit, query.category);
    return { items: results.map((food) => this.toFoodResponse(food)) };
  }

  async getFoodById(viewer: User, id: string): Promise<FoodResponse> {
    const food = await this.nutritionRepository.findFoodById(id);
    if (!food || this.isHiddenFrom(food, viewer)) {
      throw this.refuseFood();
    }
    return this.toFoodResponse(food);
  }

  async createCustomFood(owner: User, body: CreateCustomFoodRequest): Promise<FoodResponse> {
    const food = await this.nutritionRepository.createCustomFood(owner.id, {
      name: body.name,
      category: body.category,
      macrosPer100g: {
        kcal: body.kcalPer100g,
        protein: body.proteinPer100g,
        carbs: body.carbsPer100g,
        fat: body.fatPer100g,
      },
      servings: [],
    });
    return this.toFoodResponse(food);
  }

  async deleteCustomFood(owner: User, id: string): Promise<void> {
    const deleted = await this.nutritionRepository.softDeleteCustomFood(id, owner.id);
    if (!deleted) {
      throw this.refuseFood();
    }
  }

  /** A custom food owned by someone else is invisible, the same way another user's private profile is (`AthletesService`). Catalogue foods (`ownerUserId === null`) are visible to everyone. */
  private isHiddenFrom(food: Food, viewer: User): boolean {
    return food.ownerUserId !== null && food.ownerUserId !== viewer.id;
  }

  private refuseFood(): NotFoundException {
    return new NotFoundException("Food not found");
  }

  private toFoodResponse(food: Food): FoodResponse {
    return {
      id: food.id,
      name: food.name,
      category: food.category,
      macrosPer100g: food.macrosPer100g,
      servings: food.servings,
      isCustom: food.ownerUserId !== null,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Macro goals
  // ---------------------------------------------------------------------------------------

  /** No seeded default (`nutrition.schema.ts`'s own docblock) -- 404 rather than a fabricated `{kcal:0,...}`, so the client shows an honest "set your goals" prompt instead of a ring against a value nobody chose. */
  async getMacroGoals(viewer: User): Promise<MacroGoalsResponse> {
    const goals = await this.nutritionRepository.getMacroGoals(viewer.id);
    if (!goals) {
      throw new NotFoundException("No macro goals set");
    }
    return goals;
  }

  async setMacroGoals(viewer: User, body: SetMacroGoalsRequest): Promise<MacroGoalsResponse> {
    const goals: MacroTotals = { kcal: body.kcal, protein: body.protein, carbs: body.carbs, fat: body.fat };
    return this.nutritionRepository.setMacroGoals(viewer.id, goals);
  }

  // ---------------------------------------------------------------------------------------
  // Saved meals
  // ---------------------------------------------------------------------------------------

  async listSavedMeals(viewer: User): Promise<SavedMealListResponse> {
    const meals = await this.nutritionRepository.listSavedMeals(viewer.id);
    return { items: meals.map((meal) => this.toSavedMealResponse(meal)) };
  }

  async createSavedMeal(viewer: User, body: CreateSavedMealRequest): Promise<SavedMealResponse> {
    const meal = await this.nutritionRepository.createSavedMeal(viewer.id, body.name, body.items);
    return this.toSavedMealResponse(meal);
  }

  async deleteSavedMeal(viewer: User, id: string): Promise<void> {
    const deleted = await this.nutritionRepository.deleteSavedMeal(id, viewer.id);
    if (!deleted) {
      throw new NotFoundException("Saved meal not found");
    }
  }

  private toSavedMealResponse(meal: SavedMealWithItems): SavedMealResponse {
    return { id: meal.id, name: meal.name, items: meal.items };
  }

  // ---------------------------------------------------------------------------------------
  // The daily log
  // ---------------------------------------------------------------------------------------

  async listLogForDate(viewer: User, loggedDate: string): Promise<NutritionLogListResponse> {
    const entries = await this.nutritionRepository.listLogForDate(viewer.id, loggedDate);
    return { items: entries.map((entry) => this.toLogEntryResponse(entry)) };
  }

  /**
   * Never accepts a caller-supplied macro value -- only `foodId`/`slot`/`loggedDate`/
   * `servingLabel`/`grams` reach the repository, which computes and snapshots the macros
   * itself from the food's current per-100g values (carried forward from the plan: a client
   * that could supply its own kcal/protein/carbs/fat could log any calorie count against any
   * food id).
   */
  async logFood(viewer: User, body: LogFoodRequest): Promise<NutritionLogEntryResponse> {
    const food = await this.nutritionRepository.findFoodById(body.foodId);
    if (!food || this.isHiddenFrom(food, viewer)) {
      throw this.refuseFood();
    }
    const entry = await this.nutritionRepository.logEntry(viewer.id, {
      foodId: body.foodId,
      slot: body.slot,
      loggedDate: body.loggedDate,
      servingLabel: body.servingLabel,
      grams: body.grams,
    });
    return this.toLogEntryResponse(entry);
  }

  async logSavedMeal(viewer: User, body: LogSavedMealRequest): Promise<NutritionLogListResponse> {
    // NutritionRepository.logSavedMeal reads the meal's items by id with no owner filter of its
    // own, so a stranger's saved meal id would otherwise silently log zero entries (empty
    // items) with a 200 rather than a clear refusal. Checking ownership here first closes that.
    const meals = await this.nutritionRepository.listSavedMeals(viewer.id);
    const meal = meals.find((candidate) => candidate.id === body.savedMealId);
    if (!meal) {
      throw new NotFoundException("Saved meal not found");
    }
    // The meal's current name, already in hand from the ownership check above -- passed
    // through as the `groupName` snapshot rather than a second lookup. See
    // NutritionRepository.logSavedMeal's own docblock.
    const entries = await this.nutritionRepository.logSavedMeal(
      viewer.id,
      body.savedMealId,
      body.slot,
      body.loggedDate,
      meal.name,
    );
    return { items: entries.map((entry) => this.toLogEntryResponse(entry)) };
  }

  async deleteLogEntry(viewer: User, id: string): Promise<void> {
    const deleted = await this.nutritionRepository.deleteLogEntry(id, viewer.id);
    if (!deleted) {
      throw new NotFoundException("Log entry not found");
    }
  }

  async deleteLogGroup(viewer: User, groupId: string): Promise<void> {
    const deletedCount = await this.nutritionRepository.deleteLogGroup(groupId, viewer.id);
    if (deletedCount === 0) {
      throw new NotFoundException("Log entry group not found");
    }
  }

  private toLogEntryResponse(entry: NutritionLogEntry): NutritionLogEntryResponse {
    return {
      id: entry.id,
      foodId: entry.foodId,
      loggedDate: entry.loggedDate,
      slot: entry.slot,
      servingLabel: entry.servingLabel,
      grams: entry.grams,
      kcal: entry.kcal,
      protein: entry.protein,
      carbs: entry.carbs,
      fat: entry.fat,
      groupId: entry.groupId,
      groupName: entry.groupName,
    };
  }
}
