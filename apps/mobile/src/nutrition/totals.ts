import type { NutritionLogEntryResponse } from '@forjd/contracts';

/**
 * Summing a day's logged entries into calorie and macro totals.
 *
 * Lifted out of `nutrition.tsx`, where it lived as a private function, when Home's "Nutrition
 * Today" card needed the same sum. There is deliberately no server-side daily-totals
 * endpoint -- `GET /nutrition/log` returns the entries and every client sums them -- so this
 * being one shared function rather than one per screen is what keeps the surfaces that show a
 * daily total (`nutrition.tsx` and Home) from drifting into two slightly different ideas of
 * what "today" adds up to.
 *
 * Every entry carries its own snapshotted macros (computed server-side at log time), so this
 * is a plain sum -- no serving maths, no lookup against the food it came from.
 */
export interface MacroTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const EMPTY_TOTALS: MacroTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function sumTotals(entries: NutritionLogEntryResponse[]): MacroTotals {
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
