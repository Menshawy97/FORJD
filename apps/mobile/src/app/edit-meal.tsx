import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { createSavedMeal, deleteSavedMeal, getFood, listSavedMeals } from '@/auth/apiClient';
import { classifyRequestFailure, isConflict, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import {
  macroForDraftItem,
  totalsForDraftItems,
  useMealDraft,
  type MealDraftItem,
} from '@/features/nutrition/meal-draft-context';
import { colors } from '@/theme/tokens';

/**
 * `s_editMeal()`, Phase H (`docs/product/nutrition-plan.md`), verified against the real
 * screenshot (`FORJD mobile app design/screenshots/EditSavedMeal.png`). Reached only from
 * `saved-meals.tsx`'s pencil icon (`openEditMeal` in the prototype), with `editMealId` as the
 * route param.
 *
 * **No update endpoint exists** -- `nutrition.controller.ts` only has `POST /nutrition/meals`,
 * `GET /nutrition/meals`, `DELETE /nutrition/meals/:id`. "Save Meal" therefore follows the same
 * delete-then-recreate precedent `food/[id].tsx` already established for a single log entry:
 * `deleteSavedMeal(originalId)` then `createSavedMeal({name, items})`, once, only when the
 * button is tapped -- never per-edit. This is safe because `nutrition_log_entries.groupId` is a
 * bare, independently-generated `uuid` column with no foreign key back to `saved_meals`
 * (`nutrition.schema.ts`), so a saved meal's id changing on every edit can never orphan or
 * rewrite already-logged history.
 *
 * **No per-meal GET endpoint exists either.** The draft is populated by re-listing every saved
 * meal (`listSavedMeals()`) and matching on `editMealId` -- the same "no update endpoint, so
 * recover state by re-listing and matching an id" adaptation `food/[id].tsx`'s own docblock
 * already documents for a single log entry.
 *
 * **The population effect guards against overwriting an in-progress draft.** `food/[id].tsx`'s
 * meal-mode branch returns here via `router.back()` x2 into this same still-mounted screen
 * instance (not a fresh push), so on that return `mealDraft.draft.id` already equals
 * `editMealId` and the effect is a no-op -- if it always re-fetched, the ingredient just added
 * would be immediately clobbered by the server's stale copy of the meal.
 */

function errorMessage(error: unknown): string {
  return classifyRequestFailure(error) === 'offline' ? OFFLINE_MESSAGE : 'Something went wrong. Try again.';
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function EditMealScreen() {
  const params = useLocalSearchParams<{ editMealId?: string }>();
  const editMealId = firstParam(params.editMealId);
  const toast = useToast();
  const { draft, startDraft, renameDraft, removeItem, updateItemGrams, clearDraft } = useMealDraft();

  useEffect(() => {
    if (!editMealId) {
      router.replace('/saved-meals');
      return;
    }
    // Already populated for this meal -- either a normal open-then-render, or a return trip
    // from the add-ingredient flow. Re-fetching here would clobber the item just added.
    if (draft?.id === editMealId) return;

    let cancelled = false;
    (async () => {
      try {
        const mealsResult = await listSavedMeals();
        const meal = mealsResult.items.find((item) => item.id === editMealId);
        if (!meal) {
          if (!cancelled) {
            toast.show('Meal not found');
            router.replace('/saved-meals');
          }
          return;
        }
        const foodIds = [...new Set(meal.items.map((item) => item.foodId))];
        const foods = await Promise.all(foodIds.map((foodId) => getFood(foodId)));
        const foodsById = new Map(foods.map((food) => [food.id, food]));
        const items: MealDraftItem[] = meal.items.map((item, index) => {
          const food = foodsById.get(item.foodId);
          return {
            id: `${item.foodId}-${index}`,
            foodId: item.foodId,
            name: food?.name ?? '…',
            servingLabel: item.servingLabel,
            grams: item.grams,
            macrosPer100g: food?.macrosPer100g ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 },
          };
        });
        if (!cancelled) startDraft({ id: meal.id, name: meal.name, items });
      } catch (error) {
        if (!cancelled) toast.show(errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMealId, draft?.id]);

  if (!editMealId) return null;

  const isPopulated = draft?.id === editMealId;

  const onBack = () => {
    clearDraft();
    router.back();
  };

  const openAddIngredient = () => {
    router.push({ pathname: '/food-search', params: { foodTarget: 'meal', editMealId } });
  };

  const onGramsChange = (itemId: string, value: string) => {
    const parsed = parseFloat(value.replace(/[^0-9.]/g, ''));
    updateItemGrams(itemId, Number.isFinite(parsed) ? Math.max(1, parsed) : 1);
  };

  const onSave = async () => {
    if (!draft || !draft.id) return;
    const name = draft.name.trim() || 'Meal';

    let deleted = false;
    try {
      await deleteSavedMeal(draft.id);
      deleted = true;
      await createSavedMeal({
        name,
        items: draft.items.map((item) => ({
          foodId: item.foodId,
          servingLabel: item.servingLabel,
          grams: item.grams,
        })),
      });
      clearDraft();
      toast.show('Saved meal updated');
      router.replace('/saved-meals');
    } catch (error) {
      if (deleted) {
        // The old meal is genuinely gone (delete already succeeded) -- a name conflict here
        // means another saved meal now has this name (`saved_meals_owner_name_unique`), which
        // needs a message that says so, not the generic "try again".
        toast.show(
          isConflict(error)
            ? `Removed the old version of "${name}", but you already have another saved meal with that name. Rename it and try again.`
            : `Removed the old version of "${name}", but couldn't save the new one. Try again.`,
        );
      } else {
        toast.show(errorMessage(error));
      }
    }
  };

  if (!isPopulated) {
    return (
      <ScreenBackground>
        <Header title="Edit Meal" onBack={onBack} />
      </ScreenBackground>
    );
  }

  const totals = totalsForDraftItems(draft.items);

  return (
    <ScreenBackground>
      <Header title="Edit Meal" onBack={onBack} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled">
        <TextInput
          value={draft.name}
          onChangeText={renameDraft}
          className="h-[50px] w-full rounded-[11px] border border-border bg-fieldBg px-[15px] font-archivo text-[15px] font-bold text-text"
          style={{ marginBottom: 6 }}
        />
        <Text className="font-archivo text-[12px] font-medium text-dimmer">
          {`${draft.items.length} items · ${Math.round(totals.kcal)} kcal · P${Math.round(totals.protein)} C${Math.round(totals.carbs)} F${Math.round(totals.fat)}`}
        </Text>

        <View style={{ marginTop: 18, gap: 8 }}>
          {draft.items.length > 0 ? (
            draft.items.map((item) => {
              const macro = macroForDraftItem(item);
              return (
                <View
                  key={item.id}
                  className="flex-row items-center rounded-xl border border-border bg-surface px-[12px] py-[11px]"
                  style={{ gap: 10 }}>
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <Text className="font-archivo text-[13.5px] font-semibold text-text" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="mt-[3px] font-archivo text-[11px] text-dimmer">
                      {`${Math.round(macro.kcal)} kcal`}
                    </Text>
                  </View>
                  <View
                    className="flex-row items-center rounded-lg border px-[9px] py-[6px]"
                    style={{ gap: 6, borderColor: colors.borderCheckbox, backgroundColor: colors.bg }}>
                    <TextInput
                      value={String(item.grams)}
                      onChangeText={(value) => onGramsChange(item.id, value)}
                      keyboardType="decimal-pad"
                      className="w-[42px] text-right font-archivo text-[13px] font-bold text-text"
                    />
                    <Text className="font-archivo text-[11px] text-dimmer">g</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.name}`}
                    onPress={() => removeItem(item.id)}
                    hitSlop={8}>
                    <Icon name="x" color={colors.dim} size={14} />
                  </Pressable>
                </View>
              );
            })
          ) : (
            <Text className="py-5 text-center font-archivo text-[13px] text-dimmer">
              No ingredients — add one below.
            </Text>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={openAddIngredient}
          className="flex-row items-center py-[9px]"
          style={{ gap: 8, marginTop: 14 }}>
          <Icon name="plus" color={colors.accent} size={15} />
          <Text className="font-archivo text-[13px] font-semibold text-accent">Add ingredient</Text>
        </Pressable>
      </ScrollView>

      <View className="border-t border-border px-screen-x pb-[24px] pt-[12px]">
        <Pressable
          accessibilityRole="button"
          onPress={onSave}
          className="h-[52px] items-center justify-center rounded-button bg-accent">
          <Text className="font-archivo text-[14px] font-bold text-white">Save Meal</Text>
        </Pressable>
      </View>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
