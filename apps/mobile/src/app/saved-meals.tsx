import { MEAL_SLOT_DISPLAY_NAMES, MEAL_SLOTS, type MealSlot } from '@forjd/domain';
import type { FoodResponse, SavedMealResponse } from '@forjd/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { deleteSavedMeal, getFood, listSavedMeals, logSavedMeal } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { MealSlotChip } from '@/components/meal-slot-chip';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { todayLocalDate } from '@/nutrition/date';
import { colors } from '@/theme/tokens';

/**
 * `s_savedMeals()`, Phase H (`docs/product/nutrition-plan.md`), verified against the real
 * screenshot (`FORJD mobile app design/screenshots/saved meals page.png`). Replaces the Phase F
 * placeholder that stood in for the dashboard's "star" icon / "See all" link target.
 *
 * **`foodsById` name-and-macro resolution**, mirroring `nutrition.tsx`/`food-search.tsx`'s own
 * pattern: `SavedMealResponse.items` carries only `foodId`/`servingLabel`/`grams`, no food name
 * or per-100g macros -- every distinct `foodId` referenced across every saved meal is fetched
 * once (deduplicated) and kept in a map every row reads from.
 *
 * **Log-this-meal sheet reuses `MealSlotChip`** (extracted from `nutrition.tsx`'s own log-meal
 * sheet this same phase) rather than a second hand-copied inline chip block, matching the
 * phase's own instruction to reuse the existing chip pattern.
 */

function macroFor(food: FoodResponse, grams: number): { kcal: number; protein: number; carbs: number; fat: number } {
  const factor = grams / 100;
  return {
    kcal: food.macrosPer100g.kcal * factor,
    protein: food.macrosPer100g.protein * factor,
    carbs: food.macrosPer100g.carbs * factor,
    fat: food.macrosPer100g.fat * factor,
  };
}

function totalsForMeal(meal: SavedMealResponse, foodsById: Record<string, FoodResponse>) {
  return meal.items.reduce(
    (totals, item) => {
      const food = foodsById[item.foodId];
      if (!food) return totals;
      const macro = macroFor(food, item.grams);
      return {
        kcal: totals.kcal + macro.kcal,
        protein: totals.protein + macro.protein,
        carbs: totals.carbs + macro.carbs,
        fat: totals.fat + macro.fat,
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function errorMessage(error: unknown): string {
  return classifyRequestFailure(error) === 'offline' ? OFFLINE_MESSAGE : 'Something went wrong. Try again.';
}

export default function SavedMealsScreen() {
  const toast = useToast();
  const [meals, setMeals] = useState<SavedMealResponse[]>([]);
  const [foodsById, setFoodsById] = useState<Record<string, FoodResponse>>({});
  const [logMealSheet, setLogMealSheet] = useState<SavedMealResponse | null>(null);
  const [logMealSlot, setLogMealSlot] = useState<MealSlot>('breakfast');
  // Same double-submit guard as nutrition.tsx's own log-meal sheet -- a real bug found live on
  // a device ("it lags and sometimes doesn't work"): no disabled state let a second tap during
  // the first request's flight fire a concurrent duplicate log.
  const [loggingMeal, setLoggingMeal] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const mealsResult = await listSavedMeals();
      const foodIds = [...new Set(mealsResult.items.flatMap((meal) => meal.items.map((item) => item.foodId)))];
      const foods = await Promise.all(foodIds.map((id) => getFood(id)));
      const nextFoodsById: Record<string, FoodResponse> = {};
      foods.forEach((food) => {
        nextFoodsById[food.id] = food;
      });
      setMeals(mealsResult.items);
      setFoodsById(nextFoodsById);
    } catch (error) {
      toast.show(errorMessage(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.show]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openEditMeal = (meal: SavedMealResponse) => () => {
    router.push({ pathname: '/edit-meal', params: { editMealId: meal.id } });
  };

  const onDelete = (meal: SavedMealResponse) => async () => {
    const previous = meals;
    setMeals((current) => current.filter((item) => item.id !== meal.id));
    try {
      await deleteSavedMeal(meal.id);
      toast.show('Saved meal removed');
    } catch (error) {
      setMeals(previous);
      toast.show(errorMessage(error));
    }
  };

  const openLogMeal = (meal: SavedMealResponse) => () => {
    setLogMealSheet(meal);
    setLogMealSlot('breakfast');
  };

  const confirmLogMeal = async () => {
    if (!logMealSheet || loggingMeal) return;
    setLoggingMeal(true);
    try {
      await logSavedMeal({ savedMealId: logMealSheet.id, slot: logMealSlot, loggedDate: todayLocalDate() });
      const mealName = logMealSheet.name;
      setLogMealSheet(null);
      toast.show(`Logged "${mealName}" to ${MEAL_SLOT_DISPLAY_NAMES[logMealSlot]}`);
    } catch (error) {
      toast.show(errorMessage(error));
    } finally {
      setLoggingMeal(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="Saved Meals" onBack={() => router.back()} />

      <ScrollView className="flex-1 px-screen-x" contentContainerStyle={{ paddingBottom: 26 }}>
        {meals.length > 0 ? (
          meals.map((meal) => {
            const totals = totalsForMeal(meal, foodsById);
            return (
              <View
                key={meal.id}
                className="rounded-card border border-border bg-surface px-4 py-4"
                style={{ marginBottom: 12 }}>
                <View className="flex-row items-start justify-between">
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <Text className="font-archivo text-[15px] font-bold text-text" numberOfLines={1}>
                      {meal.name}
                    </Text>
                    <Text className="mt-1 font-archivo text-[12px] text-dimmer">
                      {`${meal.items.length} items · ${Math.round(totals.kcal)} kcal · P${Math.round(totals.protein)} C${Math.round(totals.carbs)} F${Math.round(totals.fat)}`}
                    </Text>
                  </View>
                  <View className="flex-row items-center" style={{ gap: 2 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${meal.name}`}
                      onPress={openEditMeal(meal)}
                      className="h-9 w-9 items-center justify-center"
                      hitSlop={4}>
                      <Icon name="pencil" color={colors.dim} size={15} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${meal.name}`}
                      onPress={onDelete(meal)}
                      className="h-9 w-9 items-center justify-center"
                      hitSlop={4}>
                      <Icon name="x" color={colors.dim} size={15} />
                    </Pressable>
                  </View>
                </View>

                <View style={{ marginTop: 12, gap: 6 }}>
                  {meal.items.map((item, index) => {
                    const food = foodsById[item.foodId];
                    const macro = food ? macroFor(food, item.grams) : null;
                    return (
                      <View
                        key={`${item.foodId}-${index}`}
                        className="flex-row items-center justify-between"
                        style={{ gap: 8 }}>
                        {/* `flex-1` + `minWidth:0`, matching the meal-name row above --
                            without it `numberOfLines={1}` has no width to truncate against,
                            so a long food name grows past the row and pushes the kcal text
                            off the right edge of the screen instead of ellipsizing. */}
                        <View className="flex-1" style={{ minWidth: 0 }}>
                          <Text className="font-archivo text-[12px] font-medium text-text" numberOfLines={1}>
                            {`${food?.name ?? '…'} · ${item.servingLabel}`}
                          </Text>
                        </View>
                        <Text className="font-archivo text-[12px] text-dimmer" numberOfLines={1}>
                          {`${Math.round(macro?.kcal ?? 0)} kcal`}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                <Pressable
                  accessibilityRole="button"
                  onPress={openLogMeal(meal)}
                  className="mt-[14px] h-[52px] items-center justify-center rounded-button bg-accent">
                  <Text className="font-archivo text-[14px] font-bold text-white">Log this meal</Text>
                </Pressable>
              </View>
            );
          })
        ) : (
          <Text className="mt-10 text-center font-archivo text-[13px] text-dimmer">
            No saved meals yet — save one from a meal on the Nutrition tab.
          </Text>
        )}
      </ScrollView>

      {logMealSheet ? (
        <View
          testID="log-meal-sheet"
          className="absolute inset-0 z-20 items-end justify-end"
          style={{ backgroundColor: colors.scrim }}>
          <View
            className="w-full rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]"
            style={{ gap: 14 }}>
            <Text className="font-archivo text-[18px] font-bold text-text">{`Log "${logMealSheet.name}"`}</Text>
            <Text className="font-archivo text-[13px] text-dimmer">Add all items to which meal?</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {MEAL_SLOTS.map((slot) => (
                <MealSlotChip
                  key={slot}
                  label={MEAL_SLOT_DISPLAY_NAMES[slot]}
                  selected={slot === logMealSlot}
                  onPress={() => setLogMealSlot(slot)}
                />
              ))}
            </View>
            <View className="flex-row" style={{ gap: 9, marginTop: 6 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: loggingMeal }}
                disabled={loggingMeal}
                onPress={confirmLogMeal}
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-accent"
                style={loggingMeal ? { opacity: 0.6 } : undefined}>
                <Text className="font-archivo text-[14px] font-bold text-white">
                  {loggingMeal ? 'Logging…' : 'Log'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setLogMealSheet(null)}
                className="h-[52px] w-24 items-center justify-center rounded-button border border-border">
                <Text className="font-archivo text-[14px] font-bold text-dim">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
