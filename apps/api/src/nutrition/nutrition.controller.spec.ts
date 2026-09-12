import {
  createCustomFoodRequestSchema,
  createSavedMealRequestSchema,
  foodSearchQuerySchema,
  logFoodRequestSchema,
  logSavedMealRequestSchema,
  setMacroGoalsRequestSchema,
} from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getBodySchema, getClassGuards, getQuerySchema } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { NutritionController } from "./nutrition.controller";
import { NutritionService } from "./nutrition.service";

describe("NutritionController", () => {
  let service: jest.Mocked<NutritionService>;
  let controller: NutritionController;

  beforeEach(() => {
    service = {
      searchFoods: jest.fn(),
      createCustomFood: jest.fn(),
      getFoodById: jest.fn(),
      deleteCustomFood: jest.fn(),
      getMacroGoals: jest.fn(),
      setMacroGoals: jest.fn(),
      listSavedMeals: jest.fn(),
      createSavedMeal: jest.fn(),
      deleteSavedMeal: jest.fn(),
      listLogForDate: jest.fn(),
      logFood: jest.fn(),
      logSavedMeal: jest.fn(),
      deleteLogGroup: jest.fn(),
      deleteLogEntry: jest.fn(),
    } as unknown as jest.Mocked<NutritionService>;
    controller = new NutritionController(service);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(NutritionController)).toContain(JwtAuthGuard);
  });

  describe("Zod schema wiring", () => {
    it("binds searchFoods's query to foodSearchQuerySchema", () => {
      expect(getQuerySchema(NutritionController, "searchFoods")).toBe(foodSearchQuerySchema);
    });

    it("binds createCustomFood's body to createCustomFoodRequestSchema", () => {
      expect(getBodySchema(NutritionController, "createCustomFood")).toBe(createCustomFoodRequestSchema);
    });

    it("binds setMacroGoals's body to setMacroGoalsRequestSchema", () => {
      expect(getBodySchema(NutritionController, "setMacroGoals")).toBe(setMacroGoalsRequestSchema);
    });

    it("binds createSavedMeal's body to createSavedMealRequestSchema", () => {
      expect(getBodySchema(NutritionController, "createSavedMeal")).toBe(createSavedMealRequestSchema);
    });

    it("binds logFood's body to logFoodRequestSchema", () => {
      expect(getBodySchema(NutritionController, "logFood")).toBe(logFoodRequestSchema);
    });

    it("binds logSavedMeal's body to logSavedMealRequestSchema", () => {
      expect(getBodySchema(NutritionController, "logSavedMeal")).toBe(logSavedMealRequestSchema);
    });

    it("binds listLog's query to a YYYY-MM-DD date schema (rejects other formats)", () => {
      const schema = getQuerySchema(NutritionController, "listLog") as { safeParse: (v: unknown) => { success: boolean } };

      expect(schema.safeParse({ date: "2026-01-15" }).success).toBe(true);
      expect(schema.safeParse({ date: "15/01/2026" }).success).toBe(false);
      expect(schema.safeParse({ date: "not-a-date" }).success).toBe(false);
      // Not the same schema instance as a sibling route's schema -- guards against a
      // copy-pasted pipe wiring the wrong validator.
      expect(schema).not.toBe(foodSearchQuerySchema);
    });
  });

  it("searchFoods forwards request.user and the validated query", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { query: "chicken" } as never;

    await controller.searchFoods(request, query);

    expect(service.searchFoods).toHaveBeenCalledWith(request.user, query);
  });

  it("createCustomFood forwards request.user and the validated body", async () => {
    const request = fakeAuthenticatedRequest();
    const body = { name: "Custom Bar" } as never;

    await controller.createCustomFood(request, body);

    expect(service.createCustomFood).toHaveBeenCalledWith(request.user, body);
  });

  it("getFoodById passes request.user and the path id, not the id alone", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "88888888-8888-4888-8888-888888888888";

    await controller.getFoodById(request, id);

    expect(service.getFoodById).toHaveBeenCalledWith(request.user, id);
  });

  it("deleteCustomFood scopes by request.user and the path id", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "99999999-9999-4999-8999-999999999999";

    await controller.deleteCustomFood(request, id);

    expect(service.deleteCustomFood).toHaveBeenCalledWith(request.user, id);
  });

  it("getMacroGoals/setMacroGoals scope by request.user", async () => {
    const request = fakeAuthenticatedRequest();
    await controller.getMacroGoals(request);
    expect(service.getMacroGoals).toHaveBeenCalledWith(request.user);

    const body = { proteinG: 150 } as never;
    await controller.setMacroGoals(request, body);
    expect(service.setMacroGoals).toHaveBeenCalledWith(request.user, body);
  });

  it("listSavedMeals/createSavedMeal/deleteSavedMeal scope by request.user", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.listSavedMeals(request);
    expect(service.listSavedMeals).toHaveBeenCalledWith(request.user);

    const body = { name: "Breakfast" } as never;
    await controller.createSavedMeal(request, body);
    expect(service.createSavedMeal).toHaveBeenCalledWith(request.user, body);

    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await controller.deleteSavedMeal(request, id);
    expect(service.deleteSavedMeal).toHaveBeenCalledWith(request.user, id);
  });

  it("listLog forwards request.user and the validated date", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { date: "2026-01-15" };

    await controller.listLog(request, query);

    expect(service.listLogForDate).toHaveBeenCalledWith(request.user, query.date);
  });

  it("logFood/logSavedMeal forward request.user and the validated body", async () => {
    const request = fakeAuthenticatedRequest();

    const foodBody = { foodId: "food-1", grams: 100 } as never;
    await controller.logFood(request, foodBody);
    expect(service.logFood).toHaveBeenCalledWith(request.user, foodBody);

    const mealBody = { savedMealId: "meal-1" } as never;
    await controller.logSavedMeal(request, mealBody);
    expect(service.logSavedMeal).toHaveBeenCalledWith(request.user, mealBody);
  });

  it("deleteLogGroup/deleteLogEntry scope by request.user and the path id", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.deleteLogGroup(request, "group-1");
    expect(service.deleteLogGroup).toHaveBeenCalledWith(request.user, "group-1");

    await controller.deleteLogEntry(request, "entry-1");
    expect(service.deleteLogEntry).toHaveBeenCalledWith(request.user, "entry-1");
  });
});
