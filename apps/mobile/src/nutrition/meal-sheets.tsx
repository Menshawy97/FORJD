import {
  MEAL_SLOT_DISPLAY_NAMES,
  MEAL_SLOTS,
  type MealSlot,
} from '@forjd/domain';
import type { MacroGoalSuggestionResponse, SavedMealResponse, SetMacroGoalsRequest } from '@forjd/contracts';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { MealSlotChip } from '@/components/meal-slot-chip';
import { colors } from '@/theme/tokens';

import { SuggestionCard } from './suggestion-card';

/**
 * The three bottom sheets from `nutrition.tsx` (`s_nutrition()`): "Save as meal", "Log this
 * saved meal to which slot", and "Set daily goals". Extracted verbatim -- each renders only
 * when its own piece of state is non-null/true, exactly as it did inline in the screen.
 */

export interface EditGoalsValues {
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}

interface NutritionSheetsProps {
  saveMealSlot: MealSlot | null;
  saveMealName: string;
  saveMealError: string | null;
  onChangeSaveMealName: (value: string) => void;
  onConfirmSaveMeal: () => void;
  onCancelSaveMeal: () => void;

  logMealSheet: SavedMealResponse | null;
  logMealSlot: MealSlot;
  onChangeLogMealSlot: (slot: MealSlot) => void;
  loggingMeal: boolean;
  onConfirmLogMeal: () => void;
  onCancelLogMeal: () => void;

  editGoalsOpen: boolean;
  editGoalsVals: EditGoalsValues;
  onChangeEditGoalsVal: (key: keyof EditGoalsValues, value: string) => void;
  onSaveGoals: () => void;
  onCancelEditGoals: () => void;
  /** The Auto-calculate suggestion (scan-height-age-plan.md §4.5): undefined loading, null failed. */
  goalSuggestion: MacroGoalSuggestionResponse | null | undefined;
  onUseSuggestion: (targets: SetMacroGoalsRequest) => void;
  onEditTargetsInProfile: () => void;
}

export function NutritionSheets({
  saveMealSlot,
  saveMealName,
  saveMealError,
  onChangeSaveMealName,
  onConfirmSaveMeal,
  onCancelSaveMeal,
  logMealSheet,
  logMealSlot,
  onChangeLogMealSlot,
  loggingMeal,
  onConfirmLogMeal,
  onCancelLogMeal,
  editGoalsOpen,
  editGoalsVals,
  onChangeEditGoalsVal,
  onSaveGoals,
  onCancelEditGoals,
  goalSuggestion,
  onUseSuggestion,
  onEditTargetsInProfile,
}: NutritionSheetsProps) {
  return (
    <>
      {saveMealSlot ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="absolute inset-0 z-20 items-end justify-end"
          style={{ backgroundColor: colors.scrim }}>
          <View
            className="w-full rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]"
            style={{ gap: 14 }}>
            <Text className="font-archivo text-[18px] font-bold text-text">
              {`Save ${MEAL_SLOT_DISPLAY_NAMES[saveMealSlot]} as a meal`}
            </Text>
            <View>
              <TextInput
                value={saveMealName}
                onChangeText={onChangeSaveMealName}
                className="h-[50px] rounded-[11px] border border-border bg-fieldBg px-[15px] font-archivo text-[14.5px] font-semibold text-text"
              />
              {saveMealError && (
                <Text className="mt-[10px] font-archivo text-inline-error font-medium text-errorText">
                  {saveMealError}
                </Text>
              )}
            </View>
            <View className="flex-row" style={{ gap: 9 }}>
              <Pressable
                accessibilityRole="button"
                onPress={onConfirmSaveMeal}
                // R19 (H13): white text on raw `accent` measured 3.06:1, below AA's 4.5:1 floor.
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-accentDark">
                <Text className="font-archivo text-[14px] font-bold text-white">Save</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onCancelSaveMeal}
                className="h-[52px] w-24 items-center justify-center rounded-button border border-border">
                <Text className="font-archivo text-[14px] font-bold text-dim">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}

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
                  onPress={() => onChangeLogMealSlot(slot)}
                />
              ))}
            </View>
            <View className="flex-row" style={{ gap: 9, marginTop: 6 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: loggingMeal }}
                disabled={loggingMeal}
                onPress={onConfirmLogMeal}
                // R19 (H13): white text on raw `accent` measured 3.06:1, below AA's 4.5:1 floor.
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-accentDark"
                style={loggingMeal ? { opacity: 0.6 } : undefined}>
                <Text className="font-archivo text-[14px] font-bold text-white">
                  {loggingMeal ? 'Logging…' : 'Log'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onCancelLogMeal}
                className="h-[52px] w-24 items-center justify-center rounded-button border border-border">
                <Text className="font-archivo text-[14px] font-bold text-dim">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {editGoalsOpen ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="absolute inset-0 z-20 items-end justify-end"
          style={{ backgroundColor: colors.scrim }}>
          {/* Capped at 85% of the screen with a fixed title and buttons, so the card's (i) details
              scroll in the middle instead of pushing Save off a small phone (approved 2026-09-25). */}
          <View
            className="w-full rounded-t-[18px] border-t border-border bg-surface pb-[24px] pt-[20px]"
            style={{ maxHeight: '85%' }}>
            <Text className="px-[22px] pb-[12px] font-archivo text-[18px] font-bold text-text">Set daily goals</Text>
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 4, gap: 14 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled">
            <SuggestionCard response={goalSuggestion} onUse={onUseSuggestion} onEditInProfile={onEditTargetsInProfile} />
            {(['kcal', 'protein', 'carbs', 'fat'] as const).map((key) => (
              <View key={key} className="flex-row items-center justify-between" style={{ gap: 10 }}>
                <Text className="font-archivo text-[13px] font-semibold capitalize text-text">
                  {key === 'kcal' ? 'Calories' : key}
                </Text>
                <View
                  className="flex-row items-center rounded-lg border px-[10px] py-[6px]"
                  style={{ gap: 6, borderColor: colors.borderCheckbox, backgroundColor: colors.bg }}>
                  <TextInput
                    value={editGoalsVals[key]}
                    onChangeText={(value) => onChangeEditGoalsVal(key, value.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    className="w-[52px] text-right font-archivo text-[14px] font-bold text-text"
                  />
                  <Text className="font-archivo text-[12px] text-dimmer">{key === 'kcal' ? 'kcal' : 'g'}</Text>
                </View>
              </View>
            ))}
            </ScrollView>
            <View
              className="flex-row px-[22px] pt-[12px]"
              style={{ gap: 9, borderTopWidth: 1, borderColor: 'rgba(255,255,255,.06)' }}>
              <Pressable
                accessibilityRole="button"
                onPress={onSaveGoals}
                // R19 (H13): white text on raw `accent` measured 3.06:1, below AA's 4.5:1 floor.
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-accentDark">
                <Text className="font-archivo text-[14px] font-bold text-white">Save</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onCancelEditGoals}
                className="h-[52px] w-24 items-center justify-center rounded-button border border-border">
                <Text className="font-archivo text-[14px] font-bold text-dim">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </>
  );
}
