import {
  FOOD_CATEGORIES,
  FOOD_CATEGORY_DISPLAY_NAMES,
  MEAL_SLOT_DISPLAY_NAMES,
  type FoodCategory,
  type MealSlot,
} from '@forjd/domain';
import { mealSlotSchema, type FoodResponse } from '@forjd/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { createCustomFood, searchFoods } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { FilterChip } from '@/components/filter-chip';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

/**
 * `s_foodSearch()`, `docs/design/nutrition-screen-specs.md` §3. No screenshot exists for this
 * screen -- built from the prototype's source (extracted verbatim into the Phase G plan) plus
 * the design doc, per the plan's own note that the prototype outranks every summary.
 *
 * **Server-side search, debounced ~300ms.** The prototype filters an in-memory 38-row array on
 * every keystroke; the real catalogue is 13,694+ USDA rows plus custom foods, so every
 * keystroke cannot hit the network directly (`nutrition-plan.md`'s Phase G section).
 *
 * **`foodTarget === 'meal'` branch.** Nothing calls this screen with `foodTarget: 'meal'` yet --
 * Phase H's `editMeal` draft does not exist -- but the branch is implemented now per the
 * screens' own spec (a single component covers both entry points in the prototype too), so
 * Phase H does not have to reopen this file.
 *
 * **Custom-food category chip row is new** (not in the prototype): `createCustomFoodRequestSchema`
 * rejects the prototype's hardcoded `category: 'Custom'` literal, so the sheet picks one of the
 * 8 real `FOOD_CATEGORIES` instead -- decision 1 in the Phase G plan section.
 *
 * **Real validation via toast**, not the prototype's silent no-ops on an empty name -- decision 2.
 */

const DEBOUNCE_MS = 300;

type CategoryFilter = FoodCategory | 'all';
const CATEGORY_CHIPS: CategoryFilter[] = ['all', ...FOOD_CATEGORIES];

function categoryChipLabel(category: CategoryFilter): string {
  return category === 'all' ? 'All' : FOOD_CATEGORY_DISPLAY_NAMES[category];
}

function firstServing(food: FoodResponse): { label: string; grams: number } {
  return food.servings[0] ?? { label: '100 g', grams: 100 };
}

function firstServingKcal(food: FoodResponse): number {
  const serving = firstServing(food);
  return Math.round((food.macrosPer100g.kcal * serving.grams) / 100);
}

function errorMessage(error: unknown): string {
  return classifyRequestFailure(error) === 'offline' ? OFFLINE_MESSAGE : 'Something went wrong. Try again.';
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface CustomFoodValues {
  name: string;
  category: FoodCategory | null;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}

const EMPTY_CUSTOM_FOOD: CustomFoodValues = { name: '', category: null, kcal: '', protein: '', carbs: '', fat: '' };

/**
 * A blank field is `0`, not invalid -- `createCustomFoodRequestSchema` accepts `min(0)`, and a
 * genuinely zero-macro food (water, black coffee) shouldn't require typing "0" into every row.
 * Only non-numeric or negative input is rejected as a real validation error.
 */
function parseNonNegativeNumber(value: string): number | null {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function FoodSearchScreen() {
  const params = useLocalSearchParams<{ slot?: string; foodTarget?: string; editMealId?: string }>();
  const toast = useToast();

  const slotParam = mealSlotSchema.safeParse(firstParam(params.slot));
  const slot: MealSlot | undefined = slotParam.success ? slotParam.data : undefined;
  const forMeal = firstParam(params.foodTarget) === 'meal';
  const editMealId = firstParam(params.editMealId);
  const invalidTarget = !forMeal && !slot;

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [results, setResults] = useState<FoodResponse[]>([]);
  const [customFoodOpen, setCustomFoodOpen] = useState(false);
  const [customFood, setCustomFood] = useState<CustomFoodValues>(EMPTY_CUSTOM_FOOD);

  useEffect(() => {
    if (invalidTarget) {
      router.replace('/nutrition');
    }
    // Only the derived boolean matters -- re-running on every params identity change would
    // still be correct, but this keeps the effect from firing on unrelated re-renders.
  }, [invalidTarget]);

  useEffect(() => {
    if (invalidTarget) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchFoods(query, category === 'all' ? undefined : category)
        .then((response) => {
          if (!cancelled) setResults(response.items);
        })
        .catch((error: unknown) => {
          if (!cancelled) toast.show(errorMessage(error));
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `toast.show` is a stable identity from useToast() -- see nutrition.tsx's own note on why
    // depending on the whole `toast` object would refire this effect forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, invalidTarget, toast.show]);

  if (invalidTarget) return null;

  const headerTitle = forMeal ? 'Add ingredient' : `Add to ${MEAL_SLOT_DISPLAY_NAMES[slot as MealSlot]}`;

  const openResult = (food: FoodResponse) => () => {
    if (forMeal) {
      router.push({
        pathname: '/food/[id]',
        params: { id: food.id, foodTarget: 'meal', ...(editMealId ? { editMealId } : {}) },
      });
      return;
    }
    router.push({ pathname: '/food/[id]', params: { id: food.id, slot: slot as MealSlot } });
  };

  const openCustomFood = () => {
    setCustomFood(EMPTY_CUSTOM_FOOD);
    setCustomFoodOpen(true);
  };

  const saveCustomFood = async () => {
    const name = customFood.name.trim();
    if (!name) {
      toast.show('Enter a food name');
      return;
    }
    if (!customFood.category) {
      toast.show('Choose a category');
      return;
    }
    const kcal = parseNonNegativeNumber(customFood.kcal);
    const protein = parseNonNegativeNumber(customFood.protein);
    const carbs = parseNonNegativeNumber(customFood.carbs);
    const fat = parseNonNegativeNumber(customFood.fat);
    if (kcal === null || protein === null || carbs === null || fat === null) {
      toast.show('Enter valid calories, protein, carbs and fat values');
      return;
    }

    try {
      const created = await createCustomFood({
        name,
        category: customFood.category,
        kcalPer100g: kcal,
        proteinPer100g: protein,
        carbsPer100g: carbs,
        fatPer100g: fat,
      });
      setCustomFoodOpen(false);
      toast.show(`Added ${created.name} to your foods`);
      setResults((current) => [created, ...current]);
    } catch (error) {
      toast.show(errorMessage(error));
    }
  };

  return (
    <ScreenBackground>
      <Header
        title={headerTitle}
        onBack={() => router.back()}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add custom food"
            onPress={openCustomFood}
            className="h-11 w-11 items-center justify-center rounded-xl"
            style={({ pressed }) => (pressed ? { backgroundColor: colors.pressedGhost } : null)}>
            <Icon name="plus" color={colors.dim} size={20} />
          </Pressable>
        }
      />

      <View className="px-screen-x">
        <View
          className="flex-row items-center rounded-[11px] border border-border bg-fieldBg px-[14px]"
          style={{ height: 46, gap: 10 }}>
          <Icon name="search" color={colors.dim} size={17} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search foods…"
            placeholderTextColor={colors.placeholder}
            className="flex-1 font-archivo text-[14px] text-text"
          />
        </View>

        <View className="flex-row flex-wrap" style={{ gap: 8, marginTop: 12 }}>
          {CATEGORY_CHIPS.map((chip) => (
            <FilterChip
              key={chip}
              label={categoryChipLabel(chip)}
              selected={chip === category}
              onPress={() => setCategory(chip)}
            />
          ))}
        </View>
      </View>

      <ScrollView className="flex-1 px-screen-x" style={{ marginTop: 10 }} showsVerticalScrollIndicator={false}>
        {results.length > 0 ? (
          results.map((food) => (
            <Pressable
              key={food.id}
              accessibilityRole="button"
              onPress={openResult(food)}
              className="flex-row items-center justify-between border-b border-borderFaint py-3"
              style={{ gap: 12 }}>
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Text className="font-archivo text-[14px] font-semibold text-text" numberOfLines={1}>
                  {food.name}
                </Text>
                <Text className="mt-0.5 font-archivo text-[11.5px] text-dimmer" numberOfLines={1}>
                  {`${FOOD_CATEGORY_DISPLAY_NAMES[food.category]} · ${firstServing(food).label}`}
                </Text>
              </View>
              <Text className="font-archivo text-[13px] font-semibold text-text">
                {`${firstServingKcal(food)} kcal`}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text className="mt-6 font-archivo text-[13px] text-dimmer">{`No foods match "${query}"`}</Text>
        )}
      </ScrollView>

      {customFoodOpen ? (
        <KeyboardAvoidingView
          testID="custom-food-sheet"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="absolute inset-0 z-20 items-end justify-end"
          style={{ backgroundColor: colors.scrim }}>
          <View
            className="w-full rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]"
            style={{ gap: 12 }}>
            <Text className="font-archivo text-[18px] font-bold text-text">Add custom food</Text>
            <TextInput
              value={customFood.name}
              onChangeText={(value) => setCustomFood((current) => ({ ...current, name: value }))}
              placeholder="Food name"
              placeholderTextColor={colors.placeholder}
              className="h-[50px] rounded-[11px] border border-border bg-fieldBg px-[15px] font-archivo text-[14.5px] font-semibold text-text"
            />
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {FOOD_CATEGORIES.map((option) => (
                <FilterChip
                  key={option}
                  label={FOOD_CATEGORY_DISPLAY_NAMES[option]}
                  selected={customFood.category === option}
                  onPress={() => setCustomFood((current) => ({ ...current, category: option }))}
                />
              ))}
            </View>
            <Text className="font-archivo text-[11.5px] text-dimmer">Enter values per 100 g</Text>
            {(
              [
                { key: 'kcal' as const, label: 'Calories', unit: 'kcal' },
                { key: 'protein' as const, label: 'Protein', unit: 'g' },
                { key: 'carbs' as const, label: 'Carbs', unit: 'g' },
                { key: 'fat' as const, label: 'Fat', unit: 'g' },
              ]
            ).map(({ key, label, unit }) => (
              <View key={key} className="flex-row items-center justify-between" style={{ gap: 10 }}>
                <Text className="font-archivo text-[13px] font-semibold text-text">{label}</Text>
                <View
                  className="flex-row items-center rounded-lg border px-[10px] py-[6px]"
                  style={{ gap: 6, borderColor: colors.borderCheckbox, backgroundColor: colors.bg }}>
                  <TextInput
                    value={customFood[key]}
                    onChangeText={(value) =>
                      setCustomFood((current) => ({ ...current, [key]: value.replace(/[^0-9.]/g, '') }))
                    }
                    keyboardType="decimal-pad"
                    className="w-[52px] text-right font-archivo text-[14px] font-bold text-text"
                  />
                  <Text className="font-archivo text-[12px] text-dimmer">{unit}</Text>
                </View>
              </View>
            ))}
            <View className="flex-row" style={{ gap: 9, marginTop: 6 }}>
              <Pressable
                accessibilityRole="button"
                onPress={saveCustomFood}
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-accent">
                <Text className="font-archivo text-[14px] font-bold text-white">Add Food</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setCustomFoodOpen(false)}
                className="h-[52px] w-24 items-center justify-center rounded-button border border-border">
                <Text className="font-archivo text-[14px] font-bold text-dim">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
