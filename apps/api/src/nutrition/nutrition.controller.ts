import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
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
import {
  createCustomFoodRequestSchema,
  createSavedMealRequestSchema,
  foodSearchQuerySchema,
  logFoodRequestSchema,
  logSavedMealRequestSchema,
  setMacroGoalsRequestSchema,
} from "@forjd/contracts";
import { z } from "zod";

import { AuthenticatedRequest, JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { NutritionService } from "./nutrition.service";

const localDateQuerySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD") });

/**
 * Authenticated-only, matching every other endpoint in this API. One controller for the whole
 * nutrition vertical (foods, macro goals, saved meals, the daily log) rather than four,
 * mirroring how `ExercisesController` is one controller for one bounded resource even though
 * it spans browse/search, custom CRUD and favourites.
 */
@Controller("nutrition")
@UseGuards(JwtAuthGuard)
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  @Get("foods")
  searchFoods(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(foodSearchQuerySchema)) query: FoodSearchQuery,
  ): Promise<FoodListResponse> {
    return this.nutritionService.searchFoods(request.user, query);
  }

  @Post("foods")
  createCustomFood(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createCustomFoodRequestSchema)) body: CreateCustomFoodRequest,
  ): Promise<FoodResponse> {
    return this.nutritionService.createCustomFood(request.user, body);
  }

  @Get("foods/:id")
  getFoodById(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<FoodResponse> {
    return this.nutritionService.getFoodById(request.user, id);
  }

  @Delete("foods/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCustomFood(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<void> {
    return this.nutritionService.deleteCustomFood(request.user, id);
  }

  @Get("macro-goals")
  getMacroGoals(@Req() request: AuthenticatedRequest): Promise<MacroGoalsResponse> {
    return this.nutritionService.getMacroGoals(request.user);
  }

  @Put("macro-goals")
  setMacroGoals(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(setMacroGoalsRequestSchema)) body: SetMacroGoalsRequest,
  ): Promise<MacroGoalsResponse> {
    return this.nutritionService.setMacroGoals(request.user, body);
  }

  @Get("meals")
  listSavedMeals(@Req() request: AuthenticatedRequest): Promise<SavedMealListResponse> {
    return this.nutritionService.listSavedMeals(request.user);
  }

  @Post("meals")
  createSavedMeal(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createSavedMealRequestSchema)) body: CreateSavedMealRequest,
  ): Promise<SavedMealResponse> {
    return this.nutritionService.createSavedMeal(request.user, body);
  }

  @Delete("meals/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSavedMeal(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<void> {
    return this.nutritionService.deleteSavedMeal(request.user, id);
  }

  @Get("log")
  listLog(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(localDateQuerySchema)) query: { date: string },
  ): Promise<NutritionLogListResponse> {
    return this.nutritionService.listLogForDate(request.user, query.date);
  }

  @Post("log")
  logFood(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(logFoodRequestSchema)) body: LogFoodRequest,
  ): Promise<NutritionLogEntryResponse> {
    return this.nutritionService.logFood(request.user, body);
  }

  @Post("log/meal")
  logSavedMeal(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(logSavedMealRequestSchema)) body: LogSavedMealRequest,
  ): Promise<NutritionLogListResponse> {
    return this.nutritionService.logSavedMeal(request.user, body);
  }

  /**
   * Declared before `log/:id` on purpose -- the same route-ordering reasoning
   * `ExercisesController`'s `catalogue` route documents: Nest matches in declaration order, and
   * a `log/:id` route declared first would treat "group" as a log-entry id rather than the
   * literal path segment it is. (In practice the two never collide here since `log/:id` is two
   * segments and `log/group/:groupId` is three, but declaring the more specific route first
   * keeps the same defensive habit.)
   */
  @Delete("log/group/:groupId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLogGroup(@Req() request: AuthenticatedRequest, @Param("groupId") groupId: string): Promise<void> {
    return this.nutritionService.deleteLogGroup(request.user, groupId);
  }

  @Delete("log/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLogEntry(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<void> {
    return this.nutritionService.deleteLogEntry(request.user, id);
  }
}
