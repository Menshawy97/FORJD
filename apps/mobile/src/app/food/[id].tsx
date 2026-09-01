import {
  MEAL_SLOTS,
  MEAL_SLOT_DISPLAY_NAMES,
  FOOD_CATEGORY_DISPLAY_NAMES,
  type MealSlot,
} from '@forjd/domain';
import { mealSlotSchema, type FoodResponse } from '@forjd/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { deleteLogEntry, getFood, listNutritionLog, logFood } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { FilterChip } from '@/components/filter-chip';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { todayLocalDate } from '@/nutrition/date';
import { colors } from '@/theme/tokens';

/**
 * `s_foodDetail()`, `docs/design/nutrition-screen-specs.md` §4. Reached three ways, all handled
 * by this one route (mirroring the prototype's own single-component structure):
 *
 *   1. New log: `food-search.tsx` -> `{ id, slot }`.
 *   2. Edit existing entry: `nutrition.tsx` -> `{ id, entryId, slot }`.
 *   3. Meal ingredient (Phase H, not wired up by anything yet): `food-search.tsx` in meal mode
 *      -> `{ id, foodTarget: 'meal', editMealId? }`.
 *
 * **No update endpoint exists.** `nutrition.controller.ts` only has `POST log`, `POST log/meal`,
 * `DELETE log/group/:groupId`, `DELETE log/:id` -- no `PATCH`. "Save Changes" in edit mode is
 * therefore `deleteLogEntry(entryId)` followed by `logFood(...)`, a client-side adaptation
 * documented in the Phase G plan section (the same class of forced adaptation nutrition.tsx's
 * own docblock already documents twice).
 *
 * **Quantity is not stored on the wire.** `LogFoodRequest` has `servingLabel` + `grams`, no
 * repeat-count field. When quantity > 1, this bakes it into the saved `servingLabel` text
 * (`"<serving label> × <qty>"`), the same suffix format the dashboard's own item-row spec uses
 * (§2), so the information survives the round trip even though the schema has no column for it.
 *
 * **Editing an existing entry does not attempt to reverse-engineer a stepper quantity.** The
 * wire model only ever gives back a final `grams` total, not the serving index and multiplier
 * that produced it. When the stored `servingLabel`/`grams` pair matches one of the food's own
 * servings exactly (the common qty-1 case), that serving is preselected; otherwise the screen
 * falls back to "Custom amount" prefilled with the real total grams -- never silently wrong,
 * just not restoring a multiplier the server never kept.
 *
 * **`nutrition.tsx`'s navigation only sends `{ id, entryId, slot }`, not the entry's own
 * `servingLabel`/`grams`** -- there is no per-entry `GET` endpoint, so the entry itself is
 * fetched by re-listing today's log (`listNutritionLog(todayLocalDate())`) and matching on
 * `entryId`, the same "no update endpoint" constraint the docblock above already covers. Today's
 * log is the only date this screen's edit entry point can ever reach, since `nutrition.tsx`
 * only ever renders today's log.
 */

const CUSTOM_SERVING_INDEX = -1;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function errorMessage(error: unknown): string {
  return classifyRequestFailure(error) === 'offline' ? OFFLINE_MESSAGE : 'Something went wrong. Try again.';
}

function macroFor(food: FoodResponse, grams: number) {
  const factor = grams / 100;
  return {
    kcal: food.macrosPer100g.kcal * factor,
    protein: food.macrosPer100g.protein * factor,
    carbs: food.macrosPer100g.carbs * factor,
    fat: food.macrosPer100g.fat * factor,
  };
}

export default function FoodDetailScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    entryId?: string;
    slot?: string;
    foodTarget?: string;
    editMealId?: string;
  }>();

  const id = firstParam(params.id);
  const entryId = firstParam(params.entryId);
  const slotParam = mealSlotSchema.safeParse(firstParam(params.slot));
  const paramSlot: MealSlot | undefined = slotParam.success ? slotParam.data : undefined;
  const forMeal = firstParam(params.foodTarget) === 'meal';
  const invalidId = !id;

  const toast = useToast();
  const [food, setFood] = useState<FoodResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [servingIdx, setServingIdx] = useState<number>(0);
  const [qty, setQty] = useState(1);
  const [customGrams, setCustomGrams] = useState('');
  const [logAsSlot, setLogAsSlot] = useState<MealSlot>(paramSlot ?? 'breakfast');

  const editing = !!entryId;

  useEffect(() => {
    if (invalidId) {
      router.replace('/nutrition');
    }
  }, [invalidId]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await getFood(id);
        if (cancelled) return;
        setFood(result);

        if (!entryId) {
          // New-log mode: default to the first real serving, or Custom amount for a
          // gram-only food (Phase A's decision on foods with no vendored portions).
          if (paramSlot) setLogAsSlot(paramSlot);
          setServingIdx(result.servings.length > 0 ? 0 : CUSTOM_SERVING_INDEX);
          return;
        }

        // Edit mode: no per-entry GET endpoint exists, so the entry's own servingLabel/grams
        // are recovered by re-listing today's log and matching on id -- see the docblock.
        const log = await listNutritionLog(todayLocalDate());
        if (cancelled) return;
        const entry = log.items.find((item) => item.id === entryId);
        if (!entry) {
          setNotFound(true);
          return;
        }
        setLogAsSlot(entry.slot);
        const matchIdx = result.servings.findIndex(
          (serving) => serving.label === entry.servingLabel && serving.grams === entry.grams,
        );
        if (matchIdx >= 0) {
          setServingIdx(matchIdx);
          setQty(1);
        } else {
          setServingIdx(CUSTOM_SERVING_INDEX);
          setCustomGrams(String(entry.grams));
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, entryId]);

  useEffect(() => {
    if (notFound) {
      router.replace('/nutrition');
    }
  }, [notFound]);

  if (invalidId) return null;

  if (!food) {
    return (
      <ScreenBackground>
        <Header title="Food" onBack={() => router.back()} />
      </ScreenBackground>
    );
  }

  const isCustomAmount = servingIdx === CUSTOM_SERVING_INDEX;
  const selectedServing = !isCustomAmount ? food.servings[servingIdx] : undefined;
  const grams = isCustomAmount ? Number(customGrams) || 0 : (selectedServing?.grams ?? 0) * qty;
  const macro = macroFor(food, grams);

  const footerLabel = editing ? 'Save Changes' : forMeal ? 'Add Ingredient' : 'Add to Log';

  const selectServing = (index: number) => {
    setServingIdx(index);
    setQty(1);
  };

  const selectCustomAmount = () => {
    setServingIdx(CUSTOM_SERVING_INDEX);
  };

  const decrementQty = () => setQty((current) => Math.max(1, current - 1));
  const incrementQty = () => setQty((current) => current + 1);

  const servingLabelForSave = (): string => {
    if (isCustomAmount) return `${grams} g (custom)`;
    const base = selectedServing?.label ?? '100 g';
    return qty > 1 ? `${base} × ${qty}` : base;
  };

  const onPrimary = async () => {
    if (isCustomAmount && customGrams.trim() === '') {
      toast.show('Enter an amount in grams');
      return;
    }

    if (forMeal) {
      // Phase H's editMeal draft does not exist yet, so there is nowhere to append this
      // ingredient today -- nothing calls this screen with `foodTarget: 'meal'` in
      // production. The branch exists per the screens' own spec; returning is the only
      // defensible action until Phase H gives it a destination.
      router.back();
      return;
    }

    const servingLabel = servingLabelForSave();

    // Edit mode is delete-then-recreate (see the docblock above). If `deleteLogEntry` succeeds
    // but `logFood` then fails, the old entry is genuinely gone and not recreated -- a
    // distinguishable failure, not just "your edit didn't go through", so it needs its own
    // message rather than reusing `errorMessage`'s generic offline/something-went-wrong copy.
    let deleted = false;
    try {
      if (editing && entryId) {
        await deleteLogEntry(entryId);
        deleted = true;
      }
      await logFood({
        foodId: food.id,
        slot: logAsSlot,
        loggedDate: todayLocalDate(),
        servingLabel,
        grams,
      });
      toast.show(`${editing ? 'Updated' : 'Logged'} ${food.name} — ${MEAL_SLOT_DISPLAY_NAMES[logAsSlot]}`);
      router.replace('/nutrition');
    } catch (error) {
      if (deleted) {
        toast.show(`Removed the old entry, but couldn't save the new one. ${food.name} is no longer logged — try again.`);
      } else {
        toast.show(errorMessage(error));
      }
    }
  };

  const onRemove = async () => {
    if (!entryId) return;
    try {
      await deleteLogEntry(entryId);
      router.replace('/nutrition');
    } catch (error) {
      toast.show(errorMessage(error));
    }
  };

  return (
    <ScreenBackground>
      <Header title={food.name} onBack={() => router.back()} />

      <ScrollView className="flex-1 px-screen-x" contentContainerStyle={{ paddingBottom: 26 }}>
        <Text className="font-archivo text-[11.5px] text-dimmer">{FOOD_CATEGORY_DISPLAY_NAMES[food.category]}</Text>

        <View
          className="items-center rounded-card border border-border bg-surface px-[18px] py-[20px]"
          style={{ marginTop: 12 }}>
          <Text
            testID="detail-kcal"
            className="font-archivo text-[34px] font-bold text-text"
            style={{ fontVariant: ['tabular-nums'] }}>
            {Math.round(macro.kcal)}
          </Text>
          <Text className="font-archivo text-[11px] text-dimmer">kcal</Text>
          <View className="flex-row" style={{ gap: 24, marginTop: 14 }}>
            <MacroStat label="Protein" value={macro.protein} color={colors.accent} />
            <MacroStat label="Carbs" value={macro.carbs} color={colors.nutritionCarbs} />
            <MacroStat label="Fat" value={macro.fat} color={colors.green} />
          </View>
        </View>

        <Text
          className="font-archivo text-[11px] font-semibold uppercase tracking-wide text-label"
          style={{ marginTop: 22, marginBottom: 8 }}>
          Serving
        </Text>
        {food.servings.map((serving, index) => {
          const selected = servingIdx === index;
          return (
            <Pressable
              key={`${serving.label}-${index}`}
              accessibilityRole="button"
              onPress={() => selectServing(index)}
              className="flex-row items-center justify-between rounded-[11px] border px-[14px] py-3"
              style={{
                marginBottom: 8,
                backgroundColor: selected ? colors.pickRowSelectedBg : 'transparent',
                borderColor: selected ? colors.borderPickRowSelected : colors.border,
              }}>
              <Text className="font-archivo text-[13.5px] font-semibold text-text">{serving.label}</Text>
              <Text className="font-archivo text-[12.5px] text-dimmer">
                {`${Math.round((food.macrosPer100g.kcal * serving.grams) / 100)} kcal`}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          onPress={selectCustomAmount}
          className="flex-row items-center justify-between rounded-[11px] border px-[14px] py-3"
          style={{
            backgroundColor: isCustomAmount ? colors.pickRowSelectedBg : 'transparent',
            borderColor: isCustomAmount ? colors.borderPickRowSelected : colors.border,
          }}>
          <Text className="font-archivo text-[13.5px] font-semibold text-text">Custom amount</Text>
          {isCustomAmount ? (
            <View
              className="flex-row items-center rounded-lg border px-[10px] py-[6px]"
              style={{ gap: 6, borderColor: colors.borderCheckbox, backgroundColor: colors.bg }}>
              <TextInput
                value={customGrams}
                onChangeText={(value) => setCustomGrams(value.replace(/[^0-9.]/g, ''))}
                placeholder="0"
                placeholderTextColor={colors.placeholder}
                keyboardType="decimal-pad"
                className="w-[52px] text-right font-archivo text-[14px] font-bold text-text"
              />
              <Text className="font-archivo text-[12px] text-dimmer">g</Text>
            </View>
          ) : (
            <Text className="font-archivo text-[12.5px] text-dimmer">enter grams</Text>
          )}
        </Pressable>

        {!isCustomAmount ? (
          <>
            <Text
              className="font-archivo text-[11px] font-semibold uppercase tracking-wide text-label"
              style={{ marginTop: 22, marginBottom: 8 }}>
              Quantity
            </Text>
            <View className="flex-row items-center" style={{ gap: 16 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                onPress={decrementQty}
                className="h-11 w-11 items-center justify-center rounded-full border border-border">
                <Text className="font-archivo text-[18px] font-bold text-text">−</Text>
              </Pressable>
              <Text
                testID="detail-qty"
                className="font-archivo text-[16px] font-bold text-text"
                style={{ minWidth: 24, textAlign: 'center' }}>
                {qty}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                onPress={incrementQty}
                className="h-11 w-11 items-center justify-center rounded-full border border-border">
                <Text className="font-archivo text-[18px] font-bold text-text">+</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {!forMeal ? (
          <>
            <Text
              className="font-archivo text-[11px] font-semibold uppercase tracking-wide text-label"
              style={{ marginTop: 22, marginBottom: 8 }}>
              Log as
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {MEAL_SLOTS.map((slot) => (
                <FilterChip
                  key={slot}
                  label={MEAL_SLOT_DISPLAY_NAMES[slot]}
                  selected={slot === logAsSlot}
                  onPress={() => setLogAsSlot(slot)}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <View className="border-t border-border px-screen-x pb-[24px] pt-[14px]" style={{ gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          onPress={onPrimary}
          className="h-[52px] items-center justify-center rounded-button bg-accent">
          <Text className="font-archivo text-[14px] font-bold text-white">{footerLabel}</Text>
        </Pressable>
        {editing ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRemove}
            className="h-[52px] items-center justify-center rounded-button border border-border">
            <Text className="font-archivo text-[14px] font-bold text-destructive">Remove Entry</Text>
          </Pressable>
        ) : null}
      </View>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

interface MacroStatProps {
  label: string;
  value: number;
  color: string;
}

function MacroStat({ label, value, color }: MacroStatProps) {
  return (
    <View className="items-center">
      <Text className="font-archivo text-[15px] font-bold" style={{ color }}>
        {`${Math.round(value)}g`}
      </Text>
      <Text className="mt-0.5 font-archivo text-[10px] text-dimmer">{label}</Text>
    </View>
  );
}
