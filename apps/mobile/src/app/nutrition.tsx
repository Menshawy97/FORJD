import {
  MEAL_SLOT_DISPLAY_NAMES,
  MEAL_SLOTS,
  type MealSlot,
} from '@forjd/domain';
import type { FoodResponse, MacroGoalsResponse, NutritionLogEntryResponse, SavedMealResponse } from '@forjd/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import {
  createSavedMeal,
  deleteLogEntry,
  deleteLogGroup,
  getFood,
  getMacroGoals,
  listNutritionLog,
  listSavedMeals,
  logSavedMeal as apiLogSavedMeal,
  setMacroGoals,
} from '@/auth/apiClient';
import { classifyRequestFailure, isConflict, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { MealSlotChip } from '@/components/meal-slot-chip';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { todayLocalDate } from '@/nutrition/date';
import { colors } from '@/theme/tokens';

/**
 * `s_nutrition()`, `docs/design/nutrition-screen-specs.md` §2, verified against the real
 * screenshot (`FORJD mobile app design/screenshots/nutrition dashboard.png`). Reached from
 * Home (not yet built -- Phase H), so there is no `onBack`: this is "a destination, not a
 * sub-screen" per the design, confirmed by the screenshot showing no back chevron.
 *
 * **One adaptation from the prototype, forced by the real wire shapes Phase E shipped, not a
 * stylistic choice:** `NutritionLogEntryResponse`/`SavedMealResponse.items` carry only
 * `foodId`, not a food's name or category -- Phase E's own docblock says joining that in is "a
 * later phase's job". This screen does it client-side: once the log and saved meals are
 * loaded, every distinct `foodId` referenced is fetched once (deduplicated, not once per row)
 * and kept in `foodsById` for every row to read a name from.
 *
 * **No "qty" field.** The prototype's `it.qty` (`'× 2'` suffix) has no equivalent in the
 * server model -- a log entry is `servingLabel` + `grams` only, no repeat count -- so the
 * serving label is shown alone.
 *
 * **Grouped log rows (`groupId`) now render collapsed, per a Phase H follow-up fix.** Phase F
 * originally rendered every item individually, reasoning that nothing in the wire model
 * recorded a saved meal's name once it was logged. `groupName` (added this phase, snapshotted
 * server-side at `logSavedMeal` time) is that name source arriving -- `buildLogRows` below
 * groups entries sharing a `groupId` into one collapsed row ("<name> · N items · tap to
 * view/collapse · kcal"), matching `s_nutrition()`'s own `mealSection()`/`toggleGroup`
 * interaction (extracted verbatim from the prototype for this fix) and the real screenshot
 * this phase's bug report named (`logsavedmeal.png` -- not actually present in this repo's
 * `screenshots/` directory at the time this was written; the prototype source is the fallback
 * source of truth here, the same "prototype outranks every summary" rule the plan states
 * elsewhere, applied because there was no screenshot to check against this time). Tapping the
 * row expands it to the individual items (indented, no per-item delete, matching the
 * prototype); the single × on the collapsed row deletes the whole group via `deleteLogGroup`.
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

interface MacroTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

const EMPTY_TOTALS: MacroTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

function sumTotals(entries: NutritionLogEntryResponse[]): MacroTotals {
  return entries.reduce<MacroTotals>(
    (totals, entry) => ({
      kcal: totals.kcal + entry.kcal,
      protein: totals.protein + entry.protein,
      carbs: totals.carbs + entry.carbs,
      fat: totals.fat + entry.fat,
    }),
    EMPTY_TOTALS,
  );
}

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function errorMessage(error: unknown): string {
  return classifyRequestFailure(error) === 'offline' ? OFFLINE_MESSAGE : 'Something went wrong. Try again.';
}

/** `createSavedMeal`'s 409 (a duplicate name, case-insensitive, for this owner --
 *  `saved_meals_owner_name_unique`) gets its own real message; everything else falls back to
 *  `errorMessage`. Mirrors `edit-profile.tsx`'s username-taken handling via the same
 *  `isConflict` helper. */
function saveMealErrorMessage(error: unknown, name: string): string {
  return isConflict(error) ? `You already have a saved meal named "${name}".` : errorMessage(error);
}

export default function NutritionScreen() {
  const toast = useToast();
  const today = useMemo(() => todayLocalDate(), []);

  const [log, setLog] = useState<NutritionLogEntryResponse[]>([]);
  const [goals, setGoals] = useState<MacroGoalsResponse | null>(null);
  const [savedMealsList, setSavedMealsList] = useState<SavedMealResponse[]>([]);
  const [foodsById, setFoodsById] = useState<Record<string, FoodResponse>>({});

  const [saveMealSlot, setSaveMealSlot] = useState<MealSlot | null>(null);
  const [saveMealName, setSaveMealName] = useState('');

  const [logMealSheet, setLogMealSheet] = useState<SavedMealResponse | null>(null);
  const [logMealSlot, setLogMealSlot] = useState<MealSlot>('breakfast');
  // Guards against a double-tap firing two concurrent `logSavedMeal` calls -- a real bug found
  // live on a device ("it lags and sometimes doesn't work"): under any network lag the button
  // had no disabled state, so a second tap during the first request's flight was easy to land.
  const [loggingMeal, setLoggingMeal] = useState(false);

  const [editGoalsOpen, setEditGoalsOpen] = useState(false);
  const [editGoalsVals, setEditGoalsVals] = useState({ kcal: '', protein: '', carbs: '', fat: '' });

  // Which grouped log rows (keyed by groupId) are expanded to show their individual items --
  // `s_nutrition()`'s own `toggleGroup`/`expandedGroups` interaction.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const loadFoods = useCallback(async (foodIds: string[], existing: Record<string, FoodResponse>) => {
    const missing = [...new Set(foodIds)].filter((id) => !existing[id]);
    if (missing.length === 0) return existing;
    const fetched = await Promise.all(missing.map((id) => getFood(id)));
    const next = { ...existing };
    fetched.forEach((food) => {
      next[food.id] = food;
    });
    return next;
  }, []);

  /**
   * `silent`: skip this function's own error toast and rethrow instead, for a caller that
   * already has a more specific thing to say (e.g. `confirmLogMeal` below, which must not let
   * a failed post-log refresh silently overwrite its own "Logged ..." success toast with this
   * function's generic one -- the exact "same class of mistake" the plan doc's Phase H note
   * flagged: a distinguishable failure needs its own message, not a reused generic one).
   */
  const loadAll = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        const [logResult, mealsResult, goalsResult] = await Promise.all([
          listNutritionLog(today),
          listSavedMeals(),
          getMacroGoals().catch(() => null),
        ]);

        const foodIds = [
          ...logResult.items.map((entry) => entry.foodId),
          ...mealsResult.items.flatMap((meal) => meal.items.map((item) => item.foodId)),
        ];
        const foods = await loadFoods(foodIds, {});

        // One commit for the whole load, not four -- every value a render could read is ready
        // before any of them changes, so there is no intermediate frame with (say) new log
        // entries but stale food names.
        setLog(logResult.items);
        setSavedMealsList(mealsResult.items);
        setGoals(goalsResult);
        setFoodsById(foods);
      } catch (error) {
        if (options?.silent) throw error;
        toast.show(errorMessage(error));
      }
    },
    // `toast` itself (from useToast()) is a fresh object every render -- only its `show`
    // function is stable. Depending on the whole object here would give `loadAll` a new
    // identity every render, and the effect below would refetch on every render forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today, loadFoods, toast.show],
  );

  // Refetches on every focus, not just first mount -- `useFocusEffect` fires on the initial
  // mount too, so this replaces (not supplements) a plain mount-only effect. Found live on a
  // device: deleting a saved meal from `saved-meals.tsx` and navigating back here left the
  // dashboard's "Saved Meals" section showing the deleted card, since nothing refetched on
  // return -- this screen's own data (the log, goals, saved meals) can all go stale the same
  // way after any action taken on another screen.
  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll]),
  );

  const totals = useMemo(() => sumTotals(log), [log]);
  const pct = goals ? Math.min(1, totals.kcal / goals.kcal) : 0;

  const entriesBySlot = useMemo(() => {
    const bySlot: Record<MealSlot, NutritionLogEntryResponse[]> = {
      breakfast: [],
      lunch: [],
      snack: [],
      dinner: [],
    };
    for (const entry of log) {
      bySlot[entry.slot].push(entry);
    }
    return bySlot;
  }, [log]);

  const openAddFood = (slot: MealSlot) => () => {
    router.push({ pathname: '/food-search', params: { slot } });
  };

  const openFoodDetail = (entry: NutritionLogEntryResponse) => () => {
    router.push({ pathname: '/food/[id]', params: { id: entry.foodId, entryId: entry.id, slot: entry.slot } });
  };

  const deleteItem = (entry: NutritionLogEntryResponse) => async () => {
    const previous = log;
    setLog((current) => current.filter((item) => item.id !== entry.id));
    try {
      await deleteLogEntry(entry.id);
      toast.show(`Removed from ${MEAL_SLOT_DISPLAY_NAMES[entry.slot]}`);
    } catch (error) {
      setLog(previous);
      toast.show(errorMessage(error));
    }
  };

  const openSaveMeal = (slot: MealSlot) => () => {
    setSaveMealSlot(slot);
    setSaveMealName(`${MEAL_SLOT_DISPLAY_NAMES[slot]} — usual`);
  };

  const confirmSaveMeal = async () => {
    if (!saveMealSlot) return;
    const items = entriesBySlot[saveMealSlot];
    if (items.length === 0) {
      setSaveMealSlot(null);
      return;
    }
    const name = saveMealName.trim() || `${MEAL_SLOT_DISPLAY_NAMES[saveMealSlot]} meal`;
    try {
      await createSavedMeal({
        name,
        items: items.map((item) => ({ foodId: item.foodId, servingLabel: item.servingLabel, grams: item.grams })),
      });
      setSaveMealSlot(null);
      toast.show(`Saved "${name}"`);
      await loadAll();
    } catch (error) {
      // Deliberately does not close the sheet on a name conflict -- the user can just edit the
      // name and try again without having to reopen it. A real bug found live on a device: this
      // had no uniqueness check at all before, so repeatedly saving the same slot (this sheet
      // pre-fills the identical "<Slot> — usual" name every time) silently created duplicate
      // cards with no error.
      toast.show(saveMealErrorMessage(error, name));
    }
  };

  const openLogMeal = (meal: SavedMealResponse) => () => {
    setLogMealSheet(meal);
    setLogMealSlot('breakfast');
  };

  const confirmLogMeal = async () => {
    if (!logMealSheet || loggingMeal) return;
    const mealName = logMealSheet.name;
    const slotLabel = MEAL_SLOT_DISPLAY_NAMES[logMealSlot];
    setLoggingMeal(true);
    try {
      await apiLogSavedMeal({ savedMealId: logMealSheet.id, slot: logMealSlot, loggedDate: today });
    } catch (error) {
      toast.show(errorMessage(error));
      setLoggingMeal(false);
      return;
    }
    setLogMealSheet(null);
    try {
      // `silent` -- a failure here means the log itself already succeeded; a generic error
      // toast at this point would silently overwrite the success message below and make a real
      // success look like a failure, the same class of "indistinguishable failure" bug the
      // delete-then-recreate flow in food/[id].tsx already had to solve once before.
      await loadAll({ silent: true });
      toast.show(`Logged "${mealName}" to ${slotLabel}`);
    } catch {
      toast.show(`Logged "${mealName}" to ${slotLabel}, but the dashboard couldn't refresh — pull down or reopen to see it.`);
    } finally {
      setLoggingMeal(false);
    }
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  };

  const deleteGroup = (groupId: string, slot: MealSlot) => async () => {
    const previous = log;
    setLog((current) => current.filter((item) => item.groupId !== groupId));
    try {
      await deleteLogGroup(groupId);
      toast.show(`Removed from ${MEAL_SLOT_DISPLAY_NAMES[slot]}`);
    } catch (error) {
      setLog(previous);
      toast.show(errorMessage(error));
    }
  };

  const openEditGoals = () => {
    setEditGoalsVals(
      goals
        ? {
            kcal: String(goals.kcal),
            protein: String(goals.protein),
            carbs: String(goals.carbs),
            fat: String(goals.fat),
          }
        : { kcal: '', protein: '', carbs: '', fat: '' },
    );
    setEditGoalsOpen(true);
  };

  const saveGoals = async () => {
    const kcal = parseInt(editGoalsVals.kcal, 10);
    const protein = parseInt(editGoalsVals.protein, 10);
    const carbs = parseInt(editGoalsVals.carbs, 10);
    const fat = parseInt(editGoalsVals.fat, 10);
    if (
      !Number.isFinite(kcal) ||
      kcal <= 0 ||
      !Number.isFinite(protein) ||
      !Number.isFinite(carbs) ||
      !Number.isFinite(fat)
    ) {
      toast.show('Enter a valid calorie goal and macro values');
      return;
    }
    try {
      const saved = await setMacroGoals({ kcal, protein, carbs, fat });
      setGoals(saved);
      setEditGoalsOpen(false);
      toast.show('Goals updated');
    } catch (error) {
      toast.show(errorMessage(error));
    }
  };

  return (
    <ScreenBackground>
      <Header
        title="Nutrition"
        right={
          <View className="flex-row items-center" style={{ gap: 2 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share nutrition"
              onPress={() => router.push('/nutrition-share')}
              className="h-11 w-11 items-center justify-center rounded-xl"
              style={({ pressed }) => (pressed ? { backgroundColor: colors.pressedGhost } : null)}>
              <Icon name="share" color={colors.dim} size={19} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set daily goals"
              onPress={openEditGoals}
              className="h-11 w-11 items-center justify-center rounded-xl"
              style={({ pressed }) => (pressed ? { backgroundColor: colors.pressedGhost } : null)}>
              <Icon name="target" color={colors.dim} size={20} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Saved meals"
              onPress={() => router.push('/saved-meals')}
              className="h-11 w-11 items-center justify-center rounded-xl"
              style={({ pressed }) => (pressed ? { backgroundColor: colors.pressedGhost } : null)}>
              <Icon name="star" color={colors.dim} size={20} />
            </Pressable>
          </View>
        }
      />

      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        {goals ? (
          <View
            className="flex-row items-center rounded-card border border-border bg-surface p-[18px]"
            style={{ gap: 18 }}>
            <View style={{ width: 120, height: 120 }}>
              <View style={{ width: 120, height: 120, transform: [{ rotate: '-90deg' }] }}>
                <Svg width={120} height={120} viewBox="0 0 120 120">
                  <Circle cx={60} cy={60} r={RING_RADIUS} fill="none" stroke="#1E1F22" strokeWidth={9} />
                  <Circle
                    cx={60}
                    cy={60}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={9}
                    strokeLinecap="round"
                    strokeDasharray={`${RING_CIRCUMFERENCE}`}
                    strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct)}
                  />
                </Svg>
              </View>
              <View className="absolute inset-0 items-center justify-center">
                <Text
                  className="font-archivo text-[22px] font-bold text-text"
                  style={{ fontVariant: ['tabular-nums'] }}>
                  {Math.round(totals.kcal)}
                </Text>
                <Text className="mt-0.5 font-archivo text-[10px] text-dimmer">{`/ ${goals.kcal} kcal`}</Text>
              </View>
            </View>
            <View className="flex-1" style={{ minWidth: 0 }}>
              <MacroBar label="Protein" value={totals.protein} goal={goals.protein} color={colors.accent} />
              <MacroBar label="Carbs" value={totals.carbs} goal={goals.carbs} color={colors.nutritionCarbs} />
              <MacroBar label="Fat" value={totals.fat} goal={goals.fat} color={colors.green} />
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={openEditGoals}
            className="rounded-card border border-border bg-surface p-[18px]">
            <Text className="font-archivo text-[15px] font-bold text-text">Set your daily goals</Text>
            <Text className="mt-1 font-archivo text-[12.5px] text-dimmer">
              Track calories and macros against a target you choose.
            </Text>
          </Pressable>
        )}

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
                    <Pressable accessibilityRole="button" onPress={openSaveMeal(slot)}>
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
                      onPress={openFoodDetail(entry)}
                      className="flex-row items-center border-b border-borderFaint py-3"
                      style={{ gap: 12 }}>
                      <View className="flex-1" style={{ minWidth: 0 }}>
                        <Text className="font-archivo text-[14px] font-semibold text-text" numberOfLines={1}>
                          {food?.name ?? '…'}
                        </Text>
                        <Text className="mt-0.5 font-archivo text-[11.5px] text-dimmer">{entry.servingLabel}</Text>
                      </View>
                      <Text
                        className="font-archivo text-[13px] font-semibold text-text"
                        style={{ fontVariant: ['tabular-nums'] }}>
                        {`${Math.round(entry.kcal)} kcal`}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${food?.name ?? 'item'}`}
                        onPress={deleteItem(entry)}
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
                      onPress={() => toggleGroup(groupId)}
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
                      <Text
                        className="font-archivo text-[13px] font-semibold text-text"
                        style={{ fontVariant: ['tabular-nums'] }}>
                        {`${Math.round(groupTotals.kcal)} kcal`}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${row.groupName ?? 'meal'}`}
                        onPress={deleteGroup(groupId, slot)}
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
                              onPress={openFoodDetail(entry)}
                              className="flex-row items-center"
                              style={{ gap: 10 }}>
                              <View className="flex-1" style={{ minWidth: 0 }}>
                                <Text
                                  className="font-archivo text-[12.5px] font-medium text-textSecondary"
                                  numberOfLines={1}>
                                  {food?.name ?? '…'}
                                </Text>
                                <Text className="mt-0.5 font-archivo text-[10.5px] text-dimmer">
                                  {entry.servingLabel}
                                </Text>
                              </View>
                              <Text
                                className="font-archivo text-[11.5px] text-dimmer"
                                style={{ fontVariant: ['tabular-nums'] }}>
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
                onPress={openAddFood(slot)}
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
              <Pressable accessibilityRole="button" onPress={() => router.push('/saved-meals')}>
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
                      onPress={openLogMeal(meal)}
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
      </ScrollView>

      <TabBar active="home" />

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
            <TextInput
              value={saveMealName}
              onChangeText={setSaveMealName}
              className="h-[50px] rounded-[11px] border border-border bg-fieldBg px-[15px] font-archivo text-[14.5px] font-semibold text-text"
            />
            <View className="flex-row" style={{ gap: 9 }}>
              <Pressable
                accessibilityRole="button"
                onPress={confirmSaveMeal}
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-accent">
                <Text className="font-archivo text-[14px] font-bold text-white">Save</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSaveMealSlot(null)}
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

      {editGoalsOpen ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="absolute inset-0 z-20 items-end justify-end"
          style={{ backgroundColor: colors.scrim }}>
          <View
            className="w-full rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]"
            style={{ gap: 14 }}>
            <Text className="font-archivo text-[18px] font-bold text-text">Set daily goals</Text>
            {/* Auto-calculate depends on InBody data, which does not exist until Phase 5
                (ADR-020) -- shown disabled with honest copy rather than computing from fake
                defaults, per nutrition-screen-specs.md §2's explicit instruction. */}
            <View
              className="flex-row items-center rounded-[11px] border px-[14px] py-3 opacity-50"
              style={{ gap: 10, borderColor: 'rgba(233,113,47,.4)', backgroundColor: 'rgba(233,113,47,.1)' }}>
              <Icon name="bolt" color={colors.accent} size={17} />
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Text className="font-archivo text-[13px] font-bold text-accent">Auto-calculate</Text>
                <Text className="mt-0.5 font-archivo text-[11px] text-weekScoreLabel">
                  Available once your InBody scan is set up
                </Text>
              </View>
            </View>
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
                    onChangeText={(value) =>
                      setEditGoalsVals((current) => ({ ...current, [key]: value.replace(/[^0-9]/g, '') }))
                    }
                    keyboardType="number-pad"
                    className="w-[52px] text-right font-archivo text-[14px] font-bold text-text"
                  />
                  <Text className="font-archivo text-[12px] text-dimmer">{key === 'kcal' ? 'kcal' : 'g'}</Text>
                </View>
              </View>
            ))}
            <View className="flex-row" style={{ gap: 9, marginTop: 6 }}>
              <Pressable
                accessibilityRole="button"
                onPress={saveGoals}
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-accent">
                <Text className="font-archivo text-[14px] font-bold text-white">Save</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditGoalsOpen(false)}
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

interface MacroBarProps {
  label: string;
  value: number;
  goal: number;
  color: string;
}

function MacroBar({ label, value, goal, color }: MacroBarProps) {
  const width = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <View style={{ marginTop: 12 }}>
      <View className="flex-row items-center justify-between" style={{ marginBottom: 6 }}>
        <Text className="font-archivo text-[12px] font-semibold text-text">{label}</Text>
        <Text
          className="font-archivo text-[11.5px] font-medium text-dimmer"
          style={{ fontVariant: ['tabular-nums'] }}>
          {`${Math.round(value)}g / ${goal}g`}
        </Text>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,.08)' }}>
        <View style={{ width: `${width}%`, height: 6, borderRadius: 4, backgroundColor: color }} />
      </View>
    </View>
  );
}
