import { Pressable, Text, View } from 'react-native';

import {
  MEAL_SLOT_DISPLAY_NAMES,
  MEAL_SLOTS,
  type MealSlot,
} from '@forjd/domain';
import type { FoodResponse, NutritionLogEntryResponse, SavedMealResponse } from '@forjd/contracts';

import { Icon } from '@/components/icon';
import { sumTotals } from '@/nutrition/totals';
import { colors } from '@/theme/tokens';

/**
 * The per-slot logged-entry list and the "Saved meals" preview section from `nutrition.tsx`
 * (`s_nutrition()`'s `mealSection()`). Extracted verbatim, including `buildLogRows` -- the
 * grouped-vs-single row split described in `nutrition.tsx`'s own docblock (Phase H's
 * collapsed-group fix) -- since it is only ever consumed here.
 */

interface LogRow {
  group: boolean;
  groupId?: string;
  groupName?: string | null;
  items: NutritionLogEntryResponse[];
}

/** Splits a slot's entries into grouped rows (one per distinct `groupId`, preserving each
 *  group's own item order) and individually-logged singles, groups first -- mirrors the
 *  prototype's own `rows=[...groups,...singles]` construction in `mealSection()`. */
function buildLogRows(items: NutritionLogEntryResponse[]): LogRow[] {
  const groups = new Map<string, LogRow>();
  const singles: LogRow[] = [];
  for (const item of items) {
    if (!item.groupId) {
      singles.push({ group: false, items: [item] });
      continue;
    }
    const existing = groups.get(item.groupId);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.groupId, { group: true, groupId: item.groupId, groupName: item.groupName, items: [item] });
    }
  }
  return [...groups.values(), ...singles];
}

interface NutritionEntryListProps {
  entriesBySlot: Record<MealSlot, NutritionLogEntryResponse[]>;
  foodsById: Record<string, FoodResponse>;
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (groupId: string) => void;
  onOpenFoodDetail: (entry: NutritionLogEntryResponse) => () => void;
  onDeleteItem: (entry: NutritionLogEntryResponse) => () => void;
  onDeleteGroup: (groupId: string, slot: MealSlot) => () => void;
  onOpenAddFood: (slot: MealSlot) => () => void;
  onOpenSaveMeal: (slot: MealSlot) => () => void;
  savedMealsList: SavedMealResponse[];
  onOpenLogMeal: (meal: SavedMealResponse) => () => void;
  onSeeAllSavedMeals: () => void;
}

export function NutritionEntryList({
  entriesBySlot,
  foodsById,
  expandedGroups,
  onToggleGroup,
  onOpenFoodDetail,
  onDeleteItem,
  onDeleteGroup,
  onOpenAddFood,
  onOpenSaveMeal,
  savedMealsList,
  onOpenLogMeal,
  onSeeAllSavedMeals,
}: NutritionEntryListProps) {
  return (
    <>
      {MEAL_SLOTS.map((slot) => {
        const items = entriesBySlot[slot];
        const subtotal = Math.round(sumTotals(items).kcal);
        return (
          <View key={slot} style={{ marginTop: 26 }}>
            <View className="flex-row items-baseline justify-between">
              <Text className="font-archivo text-[11px] font-semibold uppercase tracking-wide text-label">
                {MEAL_SLOT_DISPLAY_NAMES[slot]}
              </Text>
              {items.length > 0 ? (
                <View className="flex-row items-center" style={{ gap: 12 }}>
                  <Text className="font-archivo text-[11px] text-dimmer">{`${subtotal} kcal`}</Text>
                  <Pressable accessibilityRole="button" onPress={onOpenSaveMeal(slot)}>
                    <Text className="font-archivo text-[11px] font-semibold text-accent">Save as meal</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            {buildLogRows(items).map((row) => {
              if (!row.group) {
                const entry = row.items[0];
                const food = foodsById[entry.foodId];
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    onPress={onOpenFoodDetail(entry)}
                    className="flex-row items-center border-b border-borderFaint py-3"
                    style={{ gap: 12 }}>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Text className="font-archivo text-[14px] font-semibold text-text" numberOfLines={1}>
                        {food?.name ?? '…'}
                      </Text>
                      <Text className="mt-0.5 font-archivo text-[11.5px] text-dimmer">{entry.servingLabel}</Text>
                    </View>
                    <Text className="font-archivo text-[13px] font-semibold text-text" style={{ fontVariant: ['tabular-nums'] }}>
                      {`${Math.round(entry.kcal)} kcal`}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${food?.name ?? 'item'}`}
                      onPress={onDeleteItem(entry)}
                      hitSlop={8}>
                      <Icon name="x" color={colors.dim} size={14} />
                    </Pressable>
                  </Pressable>
                );
              }

              const groupId = row.groupId as string;
              const open = !!expandedGroups[groupId];
              const groupTotals = sumTotals(row.items);
              return (
                <View key={groupId} className="border-b border-borderFaint">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onToggleGroup(groupId)}
                    className="flex-row items-center py-3"
                    style={{ gap: 12 }}>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Text className="font-archivo text-[14px] font-semibold text-text" numberOfLines={1}>
                        {row.groupName ?? 'Meal'}
                      </Text>
                      <Text className="mt-0.5 font-archivo text-[11.5px] text-dimmer">
                        {`${row.items.length} items · tap to ${open ? 'collapse' : 'view'}`}
                      </Text>
                    </View>
                    <Text className="font-archivo text-[13px] font-semibold text-text" style={{ fontVariant: ['tabular-nums'] }}>
                      {`${Math.round(groupTotals.kcal)} kcal`}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${row.groupName ?? 'meal'}`}
                      onPress={onDeleteGroup(groupId, slot)}
                      hitSlop={8}>
                      <Icon name="x" color={colors.dim} size={14} />
                    </Pressable>
                  </Pressable>
                  {open ? (
                    <View style={{ paddingBottom: 12, paddingLeft: 14, gap: 8 }}>
                      {row.items.map((entry) => {
                        const food = foodsById[entry.foodId];
                        return (
                          <Pressable
                            key={entry.id}
                            accessibilityRole="button"
                            onPress={onOpenFoodDetail(entry)}
                            className="flex-row items-center"
                            style={{ gap: 10 }}>
                            <View className="flex-1" style={{ minWidth: 0 }}>
                              <Text className="font-archivo text-[12.5px] font-medium text-textSecondary" numberOfLines={1}>
                                {food?.name ?? '…'}
                              </Text>
                              <Text className="mt-0.5 font-archivo text-[10.5px] text-dimmer">{entry.servingLabel}</Text>
                            </View>
                            <Text className="font-archivo text-[11.5px] text-dimmer" style={{ fontVariant: ['tabular-nums'] }}>
                              {`${Math.round(entry.kcal)} kcal`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}

            <Pressable
              accessibilityRole="button"
              onPress={onOpenAddFood(slot)}
              className="flex-row items-center py-[9px]"
              style={{ gap: 8, marginTop: items.length > 0 ? 6 : 8 }}>
              <Icon name="plus" color={colors.accent} size={15} />
              <Text className="font-archivo text-[13px] font-semibold text-accent">Add food</Text>
            </Pressable>
          </View>
        );
      })}

      {savedMealsList.length > 0 ? (
        <View style={{ marginTop: 28, marginBottom: 24 }}>
          <View className="flex-row items-baseline justify-between">
            <Text className="font-archivo text-[11px] font-semibold uppercase tracking-wide text-label">
              Saved meals
            </Text>
            <Pressable accessibilityRole="button" onPress={onSeeAllSavedMeals}>
              <Text className="font-archivo text-[11px] font-semibold text-accent">See all</Text>
            </Pressable>
          </View>
          <View style={{ marginTop: 8, gap: 8 }}>
            {savedMealsList.slice(0, 3).map((meal) => {
              const mealKcal = Math.round(
                meal.items.reduce((sum, item) => {
                  const food = foodsById[item.foodId];
                  if (!food) return sum;
                  return sum + (food.macrosPer100g.kcal * item.grams) / 100;
                }, 0),
              );
              return (
                <View
                  key={meal.id}
                  className="flex-row items-center rounded-xl border border-border bg-surface px-[14px] py-3"
                  style={{ gap: 12 }}>
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <Text className="font-archivo text-[13.5px] font-semibold text-text" numberOfLines={1}>
                      {meal.name}
                    </Text>
                    <Text className="mt-0.5 font-archivo text-[11.5px] text-dimmer">
                      {`${meal.items.length} items · ${mealKcal} kcal`}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={onOpenLogMeal(meal)}
                    className="rounded-[9px] border px-[14px] py-2"
                    style={{ backgroundColor: 'rgba(233,113,47,.14)', borderColor: 'rgba(233,113,47,.4)' }}>
                    <Text className="font-archivo text-[12px] font-bold text-accent">Log</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </>
  );
}
