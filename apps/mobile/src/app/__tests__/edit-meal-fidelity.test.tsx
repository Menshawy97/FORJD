// Phase H. Ports the prototype's `s_editMeal()` -- docs/product/nutrition-plan.md's Phase H
// section, verified against the real screenshot (`EditSavedMeal.png`). See edit-meal.tsx's own
// docblock for the delete-then-recreate adaptation (no PATCH endpoint) and the population-guard
// reasoning (never clobber a draft returning from the add-ingredient flow).
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/auth/apiClient', () => ({
  listSavedMeals: jest.fn(),
  getFood: jest.fn(),
  deleteSavedMeal: jest.fn(),
  createSavedMeal: jest.fn(),
}));

import { createSavedMeal, deleteSavedMeal, getFood, listSavedMeals } from '@/auth/apiClient';

import { MealDraftProvider } from '@/features/nutrition/meal-draft-context';

import EditMealScreen from '../edit-meal';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function render(ui: ReactElement) {
  return rtlRender(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MealDraftProvider>{ui}</MealDraftProvider>
    </SafeAreaProvider>,
  );
}

const STRAWBERRY_ID = '33333333-3333-4333-8333-333333333333';
const ORANGE_ID = '44444444-4444-4444-8444-444444444444';

const strawberry = {
  id: STRAWBERRY_ID,
  name: 'Strawberries',
  category: 'fruits' as const,
  macrosPer100g: { kcal: 32, protein: 0.7, carbs: 7.7, fat: 0.3 },
  servings: [{ label: '1 cup (152g)', grams: 152 }],
  isCustom: false,
};

const orange = {
  id: ORANGE_ID,
  name: 'Orange',
  category: 'fruits' as const,
  macrosPer100g: { kcal: 47, protein: 0.9, carbs: 11.8, fat: 0.1 },
  servings: [{ label: '1 medium (131g)', grams: 131 }],
  isCustom: false,
};

const draftMeal = {
  id: 'meal-1',
  name: 'Breakfast — usual',
  items: [
    { foodId: STRAWBERRY_ID, servingLabel: '1 cup (152g)', grams: 152 },
    { foodId: ORANGE_ID, servingLabel: '1 medium (131g)', grams: 131 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { editMealId: 'meal-1' };
  (listSavedMeals as jest.Mock).mockResolvedValue({ items: [draftMeal] });
  (getFood as jest.Mock).mockImplementation((id: string) =>
    Promise.resolve(id === STRAWBERRY_ID ? strawberry : orange),
  );
  (deleteSavedMeal as jest.Mock).mockResolvedValue(undefined);
  (createSavedMeal as jest.Mock).mockResolvedValue({ id: 'meal-2', name: 'Breakfast — usual', items: [] });
});

afterEach(() => {
  cleanup();
});

describe('Edit meal', () => {
  it('populates the draft from the matching saved meal and renders its items', async () => {
    const { findByDisplayValue, findByText } = await render(<EditMealScreen />);

    expect(await findByDisplayValue('Breakfast — usual')).toBeTruthy();
    expect(await findByText('Strawberries')).toBeTruthy();
    expect(await findByText('Orange')).toBeTruthy();
    expect(await findByText(/2 items · 110 kcal · P2 C27 F1/)).toBeTruthy();
  });

  it('renaming the meal updates the name field', async () => {
    const { findByDisplayValue } = await render(<EditMealScreen />);
    const input = await findByDisplayValue('Breakfast — usual');

    fireEvent.changeText(input, 'Weekday breakfast');

    expect(await findByDisplayValue('Weekday breakfast')).toBeTruthy();
  });

  it('removing an ingredient drops it from the list and the summary', async () => {
    const { findByLabelText, findByText, queryByText } = await render(<EditMealScreen />);
    await findByText('Strawberries');

    fireEvent.press(await findByLabelText('Remove Strawberries'));

    await waitFor(() => expect(queryByText('Strawberries')).toBeNull());
    expect(await findByText(/1 items · 62 kcal/)).toBeTruthy();
  });

  it('editing the grams input recomputes that item’s kcal', async () => {
    const { findByDisplayValue, findByText } = await render(<EditMealScreen />);
    await findByText('Strawberries');

    const gramsInput = await findByDisplayValue('152');
    fireEvent.changeText(gramsInput, '200');

    // 32 kcal/100g * 200g = 64 kcal
    await waitFor(() => expect(findByText('64 kcal')).resolves.toBeTruthy());
  });

  it('"+ Add ingredient" navigates to food-search in meal mode with the draft id', async () => {
    const { findByText } = await render(<EditMealScreen />);
    await findByText('Strawberries');

    fireEvent.press(await findByText('Add ingredient'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/food-search',
      params: { foodTarget: 'meal', editMealId: 'meal-1' },
    });
  });

  it('Save Meal deletes the old meal then recreates it with the current draft', async () => {
    const { findByText, getByText } = await render(<EditMealScreen />);
    await findByText('Strawberries');

    fireEvent.press(getByText('Save Meal'));

    await waitFor(() => expect(deleteSavedMeal).toHaveBeenCalledWith('meal-1'));
    expect(createSavedMeal).toHaveBeenCalledWith({
      name: 'Breakfast — usual',
      items: [
        { foodId: STRAWBERRY_ID, servingLabel: '1 cup (152g)', grams: 152 },
        { foodId: ORANGE_ID, servingLabel: '1 medium (131g)', grams: 131 },
      ],
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/saved-meals'));
  });

  it('gives a distinguishing error when delete succeeds but recreate fails', async () => {
    (createSavedMeal as jest.Mock).mockRejectedValue(new Error('boom'));

    const { findByText, getByText } = await render(<EditMealScreen />);
    await findByText('Strawberries');

    fireEvent.press(getByText('Save Meal'));

    expect(await findByText(/couldn't save the new one/)).toBeTruthy();
  });
});
