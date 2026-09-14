import {
  MEAL_SLOT_DISPLAY_NAMES,
  type MealSlot,
} from '@forjd/domain';
import type { FoodResponse, MacroGoalsResponse, NutritionLogEntryResponse, SavedMealResponse } from '@forjd/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

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
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { DaySummary } from '@/nutrition/day-summary';
import { todayLocalDate } from '@/nutrition/date';
import { NutritionEntryList } from '@/nutrition/entry-list';
import { type EditGoalsValues, NutritionSheets } from '@/nutrition/meal-sheets';
import { sumTotals } from '@/nutrition/totals';
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
 * server-side at `logSavedMeal` time) is that name source arriving -- `buildLogRows` (now in
 * `nutrition/entry-list.tsx`) groups entries sharing a `groupId` into one collapsed row
 * ("<name> · N items · tap to view/collapse · kcal"), matching `s_nutrition()`'s own
 * `mealSection()`/`toggleGroup` interaction (extracted verbatim from the prototype for this
 * fix) and the real screenshot this phase's bug report named (`logsavedmeal.png` -- not
 * actually present in this repo's `screenshots/` directory at the time this was written; the
 * prototype source is the fallback source of truth here, the same "prototype outranks every
 * summary" rule the plan states elsewhere, applied because there was no screenshot to check
 * against this time). Tapping the row expands it to the individual items (indented, no
 * per-item delete, matching the prototype); the single × on the collapsed row deletes the
 * whole group via `deleteLogGroup`.
 *
 * **Split for R23b** into three presentational pieces so this file stays a thin composition
 * of screen-level state and handlers: `nutrition/day-summary.tsx` (the ring + macro card),
 * `nutrition/entry-list.tsx` (per-slot logged entries + saved-meals preview, including
 * `buildLogRows`), and `nutrition/meal-sheets.tsx` (the three bottom sheets). Pure refactor --
 * no behavior changed, nothing moved out of this file's own state/handlers.
 */

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
  // Shown under the name field itself rather than as a toast -- a duplicate name is something
  // the user fixes by editing the very field the error is about, so the message belongs next
  // to it, not in a banner that's already gone by the time they've read it.
  const [saveMealError, setSaveMealError] = useState<string | null>(null);

  const [logMealSheet, setLogMealSheet] = useState<SavedMealResponse | null>(null);
  const [logMealSlot, setLogMealSlot] = useState<MealSlot>('breakfast');
  // Guards against a double-tap firing two concurrent `logSavedMeal` calls -- a real bug found
  // live on a device ("it lags and sometimes doesn't work"): under any network lag the button
  // had no disabled state, so a second tap during the first request's flight was easy to land.
  const [loggingMeal, setLoggingMeal] = useState(false);

  const [editGoalsOpen, setEditGoalsOpen] = useState(false);
  const [editGoalsVals, setEditGoalsVals] = useState<EditGoalsValues>({ kcal: '', protein: '', carbs: '', fat: '' });

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
    setSaveMealError(null);
  };

  const changeSaveMealName = (value: string) => {
    setSaveMealName(value);
    // Cleared as soon as the user starts fixing it, not left showing a stale complaint about
    // text that no longer matches what's in the field.
    if (saveMealError) setSaveMealError(null);
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
      setSaveMealError(null);
      toast.show(`Saved "${name}"`);
      await loadAll();
    } catch (error) {
      // Deliberately does not close the sheet on a name conflict -- the user can just edit the
      // name and try again without having to reopen it. A real bug found live on a device: this
      // had no uniqueness check at all before, so repeatedly saving the same slot (this sheet
      // pre-fills the identical "<Slot> — usual" name every time) silently created duplicate
      // cards with no error.
      //
      // Shown inline under the field rather than as a toast: the error is about the text the
      // user is looking at, and the sheet staying open with a toast that vanishes on its own
      // timer left no persistent explanation of what to fix.
      setSaveMealError(saveMealErrorMessage(error, name));
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

  const changeEditGoalsVal = (key: keyof EditGoalsValues, value: string) => {
    setEditGoalsVals((current) => ({ ...current, [key]: value }));
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
        <DaySummary goals={goals} totals={totals} onEditGoals={openEditGoals} />

        <NutritionEntryList
          entriesBySlot={entriesBySlot}
          foodsById={foodsById}
          expandedGroups={expandedGroups}
          onToggleGroup={toggleGroup}
          onOpenFoodDetail={openFoodDetail}
          onDeleteItem={deleteItem}
          onDeleteGroup={deleteGroup}
          onOpenAddFood={openAddFood}
          onOpenSaveMeal={openSaveMeal}
          savedMealsList={savedMealsList}
          onOpenLogMeal={openLogMeal}
          onSeeAllSavedMeals={() => router.push('/saved-meals')}
        />
      </ScrollView>

      <TabBar active="home" />

      <NutritionSheets
        saveMealSlot={saveMealSlot}
        saveMealName={saveMealName}
        saveMealError={saveMealError}
        onChangeSaveMealName={changeSaveMealName}
        onConfirmSaveMeal={confirmSaveMeal}
        onCancelSaveMeal={() => setSaveMealSlot(null)}
        logMealSheet={logMealSheet}
        logMealSlot={logMealSlot}
        onChangeLogMealSlot={setLogMealSlot}
        loggingMeal={loggingMeal}
        onConfirmLogMeal={confirmLogMeal}
        onCancelLogMeal={() => setLogMealSheet(null)}
        editGoalsOpen={editGoalsOpen}
        editGoalsVals={editGoalsVals}
        onChangeEditGoalsVal={changeEditGoalsVal}
        onSaveGoals={saveGoals}
        onCancelEditGoals={() => setEditGoalsOpen(false)}
      />

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
