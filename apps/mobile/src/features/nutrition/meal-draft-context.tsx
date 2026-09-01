import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Phase H's cross-screen draft state for editing a saved meal, spanning the navigation stack
 * `editMeal -> food-search (meal mode) -> food/[id] (meal mode) -> back to editMeal`. Confirmed
 * with the user directly (`nutrition-plan.md`'s Phase H section): plain React Context, no new
 * dependency -- this codebase has no Zustand/Jotai anywhere, every existing screen is
 * `useState` + direct `apiClient` calls, so this stays consistent with that rather than
 * introducing a store for one screen pair.
 *
 * Mounted once at the root (`_layout.tsx`), the same "safe default scope" the user's own
 * decision named -- the context is cheap (`null` draft when nobody is editing a meal), so
 * there is no cost to it always being present, and it means `food/[id].tsx`'s meal-mode branch
 * never has to guess whether an ancestor provider exists.
 *
 * **`macrosPer100g` is stored per item, not a precomputed `kcal`/`protein`/etc.** Per this
 * project's immutability + "derive during render, don't duplicate" rules
 * (`rules/ecc/react/hooks.md`), a gram edit recomputes macros from the food's own per-100g
 * values via `macroForDraftItem` rather than keeping a second, potentially-stale copy in sync.
 */

export interface MealDraftItem {
  /** Client-local key for this draft session only -- never sent to the server. Distinct from
   *  `foodId` because the same food can appear in a meal more than once. */
  id: string;
  foodId: string;
  name: string;
  servingLabel: string;
  grams: number;
  macrosPer100g: { kcal: number; protein: number; carbs: number; fat: number };
}

export interface MealDraft {
  /** The `saved_meals.id` being edited. `editMeal` only ever edits an existing saved meal
   *  (meals are created via the dashboard's "Save as meal" sheet, not from this screen), so
   *  this is non-null for every draft `startDraft` is ever called with -- typed nullable only
   *  to make "no draft in progress" (`draft === null` at the container level) and "a draft
   *  with no id" the same absence, rather than inventing a second empty-state representation. */
  id: string | null;
  name: string;
  items: MealDraftItem[];
}

interface MealDraftContextValue {
  draft: MealDraft | null;
  startDraft: (draft: MealDraft) => void;
  renameDraft: (name: string) => void;
  addItem: (item: MealDraftItem) => void;
  removeItem: (itemId: string) => void;
  updateItemGrams: (itemId: string, grams: number) => void;
  clearDraft: () => void;
}

function noop() {
  /* default context value outside any provider -- see the module docblock */
}

const MealDraftContext = createContext<MealDraftContextValue>({
  draft: null,
  startDraft: noop,
  renameDraft: noop,
  addItem: noop,
  removeItem: noop,
  updateItemGrams: noop,
  clearDraft: noop,
});

interface MealDraftProviderProps {
  children: ReactNode;
}

export function MealDraftProvider({ children }: MealDraftProviderProps) {
  const [draft, setDraft] = useState<MealDraft | null>(null);

  const startDraft = useCallback((next: MealDraft) => setDraft(next), []);

  const renameDraft = useCallback((name: string) => {
    setDraft((current) => (current ? { ...current, name } : current));
  }, []);

  const addItem = useCallback((item: MealDraftItem) => {
    setDraft((current) => (current ? { ...current, items: [...current.items, item] } : current));
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setDraft((current) =>
      current ? { ...current, items: current.items.filter((item) => item.id !== itemId) } : current,
    );
  }, []);

  const updateItemGrams = useCallback((itemId: string, grams: number) => {
    setDraft((current) =>
      current
        ? { ...current, items: current.items.map((item) => (item.id === itemId ? { ...item, grams } : item)) }
        : current,
    );
  }, []);

  const clearDraft = useCallback(() => setDraft(null), []);

  const value = useMemo<MealDraftContextValue>(
    () => ({ draft, startDraft, renameDraft, addItem, removeItem, updateItemGrams, clearDraft }),
    [draft, startDraft, renameDraft, addItem, removeItem, updateItemGrams, clearDraft],
  );

  return <MealDraftContext.Provider value={value}>{children}</MealDraftContext.Provider>;
}

export function useMealDraft(): MealDraftContextValue {
  return useContext(MealDraftContext);
}

/** `grams`-proportional macros for one draft item, computed from its `macrosPer100g` snapshot
 *  -- never stored, so an edited gram amount can never disagree with its own displayed macros. */
export function macroForDraftItem(item: MealDraftItem): { kcal: number; protein: number; carbs: number; fat: number } {
  const factor = item.grams / 100;
  return {
    kcal: item.macrosPer100g.kcal * factor,
    protein: item.macrosPer100g.protein * factor,
    carbs: item.macrosPer100g.carbs * factor,
    fat: item.macrosPer100g.fat * factor,
  };
}

export function totalsForDraftItems(items: MealDraftItem[]): { kcal: number; protein: number; carbs: number; fat: number } {
  return items.reduce(
    (totals, item) => {
      const macro = macroForDraftItem(item);
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

/** Mirrors the prototype's `'f'+Date.now()+Math.random().toString(36).slice(2,6)` id scheme
 *  for a client-local key -- this id is never sent to the server (see `MealDraftItem.id`). */
export function generateDraftItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
