import { Inject, Injectable } from '@nestjs/common';
import type { AccountExportExtras, AccountExportWeeklyForge } from '@forjd/contracts';
import type { ForgeBand, ForgeLadder, ForgeOutcome, ForgeRewardType } from '@forjd/domain';
import { asc, eq, inArray } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { exerciseFavourites, exercises } from '../database/schema/exercises.schema';
import { goals } from '../database/schema/goals.schema';
import { healthConnections } from '../database/schema/health-data.schema';
import { forgeRewards, forgeUserLadders, forgeWeekAcks, forgeWeeks } from '../database/schema/forge.schema';
import { foods, foodServings, macroGoals, savedMealItems, savedMeals } from '../database/schema/nutrition.schema';
import { notificationPreferences } from '../database/schema/notification-preferences.schema';
import { preferences } from '../database/schema/preferences.schema';
import { programEnrollments } from '../database/schema/workouts.schema';

/**
 * Phase 8 / 8C. The R4 export covered the big tables; this reads the rest of what FORJD
 * stores about a user, so the export really is "everything" (GDPR Art. 15 & 20) and matches
 * what account deletion removes. Every query is scoped by `userId` (or by an id that was
 * itself read under `userId`) -- there is no path here that reads another user's row.
 *
 * Soft-deleted custom exercises and foods are included on purpose: the export is a copy of what
 * FORJD still holds about the person, and a soft-deleted row is still held until account
 * deletion. (The live screens hide them; the export must not.)
 *
 * Unbounded on purpose, like the R4 reads: an export exists to be complete. Each of these
 * collections is small per user (custom rows a person typed by hand, one row per setting).
 */
@Injectable()
export class AccountExportExtrasRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getExtras(userId: string): Promise<AccountExportExtras> {
    const [
      exerciseRows,
      favouriteRows,
      foodRows,
      [macroRow],
      mealRows,
      goalRows,
      [preferenceRow],
      [notificationRow],
      connectionRows,
      enrollmentRows,
    ] = await Promise.all([
      this.db.select().from(exercises).where(eq(exercises.ownerUserId, userId)).orderBy(asc(exercises.name)),
      this.db.select().from(exerciseFavourites).where(eq(exerciseFavourites.userId, userId)),
      this.db.select().from(foods).where(eq(foods.ownerUserId, userId)).orderBy(asc(foods.name)),
      this.db.select().from(macroGoals).where(eq(macroGoals.userId, userId)),
      this.db.select().from(savedMeals).where(eq(savedMeals.userId, userId)).orderBy(asc(savedMeals.name)),
      this.db.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.createdAt)),
      this.db.select().from(preferences).where(eq(preferences.userId, userId)),
      this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
      this.db.select().from(healthConnections).where(eq(healthConnections.userId, userId)),
      this.db
        .select()
        .from(programEnrollments)
        .where(eq(programEnrollments.userId, userId))
        .orderBy(asc(programEnrollments.startedAt)),
    ]);

    const weeklyForge = await this.weeklyForge(userId);

    const foodIds = foodRows.map((food) => food.id);
    const mealIds = mealRows.map((meal) => meal.id);
    const [servingRows, itemRows] = await Promise.all([
      foodIds.length
        ? this.db
            .select()
            .from(foodServings)
            .where(inArray(foodServings.foodId, foodIds))
            .orderBy(asc(foodServings.sortOrder))
        : Promise.resolve([]),
      mealIds.length
        ? this.db
            .select()
            .from(savedMealItems)
            .where(inArray(savedMealItems.savedMealId, mealIds))
            .orderBy(asc(savedMealItems.sortOrder))
        : Promise.resolve([]),
    ]);

    return {
      customExercises: exerciseRows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        category: row.category,
        goal: row.goal,
        measure: row.measure,
        primaryMuscles: row.primaryMuscles,
        secondaryMuscles: row.secondaryMuscles,
        equipment: row.equipment,
        instructions: row.instructions,
        description: row.description,
      })),
      favouriteExerciseIds: favouriteRows.map((row) => row.exerciseId),
      customFoods: foodRows.map((food) => ({
        id: food.id,
        name: food.name,
        category: food.category,
        kcalPer100g: Number(food.kcalPer100g),
        proteinPer100g: Number(food.proteinPer100g),
        carbsPer100g: Number(food.carbsPer100g),
        fatPer100g: Number(food.fatPer100g),
        servings: servingRows
          .filter((serving) => serving.foodId === food.id)
          .map((serving) => ({ label: serving.label, grams: Number(serving.grams) })),
      })),
      macroGoals: macroRow
        ? {
            kcal: Number(macroRow.kcal),
            protein: Number(macroRow.protein),
            carbs: Number(macroRow.carbs),
            fat: Number(macroRow.fat),
          }
        : null,
      savedMeals: mealRows.map((meal) => ({
        id: meal.id,
        name: meal.name,
        items: itemRows
          .filter((item) => item.savedMealId === meal.id)
          .map((item) => ({ foodId: item.foodId, servingLabel: item.servingLabel, grams: Number(item.grams) })),
      })),
      goals: goalRows.map((goal) => ({
        type: goal.type,
        targetValue: goal.targetValue === null ? null : Number(goal.targetValue),
        targetDate: goal.targetDate,
        status: goal.status,
      })),
      preferences: preferenceRow
        ? {
            timezone: preferenceRow.timezone,
            locale: preferenceRow.locale,
            notificationsEnabled: preferenceRow.notificationsEnabled,
          }
        : null,
      notificationPreferences: notificationRow
        ? {
            workout: notificationRow.workout,
            recovery: notificationRow.recovery,
            pr: notificationRow.pr,
            rank: notificationRow.rank,
            weekly: notificationRow.weekly,
            meals: notificationRow.meals,
            noWorkout: notificationRow.noWorkout,
            forgeClosing: notificationRow.forgeClosing,
            weighIn: notificationRow.weighIn,
            quietHours: { startMinute: notificationRow.quietStartMinute, endMinute: notificationRow.quietEndMinute },
            updatedAt: notificationRow.updatedAt.toISOString(),
          }
        : null,
      healthConnections: connectionRows.map((row) => ({
        source: row.source,
        lastSuccessfulSyncAt: row.lastSuccessfulSyncAt ? row.lastSuccessfulSyncAt.toISOString() : null,
      })),
      programEnrollmentHistory: enrollmentRows.map((row) => ({
        id: row.id,
        programId: row.programId,
        programVersion: row.programVersion,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      })),
      weeklyForge,
    };
  }

  /**
   * Weekly Forge (ADR-057). The vocabulary columns are text in the database and were written only by
   * the evaluation job from `@forjd/domain`'s tuples, so they are narrowed here, and the contract's
   * enums check them again when the export is serialised.
   */
  private async weeklyForge(userId: string): Promise<AccountExportWeeklyForge> {
    const [ladderRows, weekRows, rewardRows, ackRows] = await Promise.all([
      this.db.select().from(forgeUserLadders).where(eq(forgeUserLadders.userId, userId)).orderBy(asc(forgeUserLadders.ladderKey)),
      this.db
        .select()
        .from(forgeWeeks)
        .where(eq(forgeWeeks.userId, userId))
        .orderBy(asc(forgeWeeks.weekStart), asc(forgeWeeks.ladderKey)),
      this.db.select().from(forgeRewards).where(eq(forgeRewards.userId, userId)).orderBy(asc(forgeRewards.createdAt)),
      this.db.select().from(forgeWeekAcks).where(eq(forgeWeekAcks.userId, userId)).orderBy(asc(forgeWeekAcks.weekStart)),
    ]);

    return {
      ladders: ladderRows.map((row) => ({
        ladder: row.ladderKey as ForgeLadder,
        level: row.level,
        bestLevel: row.bestLevel,
        missStreak: row.missStreak,
        temperedHoldWeeks: row.temperedHoldWeeks,
        forgedStreak: row.forgedStreak,
        bestForgedStreak: row.bestForgedStreak,
        enrolledWeek: row.enrolledWeek,
        lastEvaluatedWeek: row.lastEvaluatedWeek,
      })),
      weeks: weekRows.map((row) => ({
        ladder: row.ladderKey as ForgeLadder,
        weekStart: row.weekStart,
        timeZone: row.timeZone,
        closesAt: row.closesAt.toISOString(),
        total: Number(row.total),
        target: Number(row.target),
        levelBefore: row.levelBefore,
        levelAfter: row.levelAfter,
        bandBefore: row.bandBefore as ForgeBand,
        bandAfter: row.bandAfter as ForgeBand,
        outcome: row.outcome as ForgeOutcome,
        rulesVersion: row.rulesVersion,
        evaluatedAt: row.evaluatedAt.toISOString(),
      })),
      rewards: rewardRows.map((row) => ({
        ladder: row.ladderKey as ForgeLadder,
        type: row.type as ForgeRewardType,
        level: row.level,
        band: row.band as ForgeBand,
        weekStart: row.weekStart,
        createdAt: row.createdAt.toISOString(),
      })),
      acknowledgedWeeks: ackRows.map((row) => row.weekStart),
    };
  }
}
