// Phase H. Ports the prototype's `s_savedMeals()` -- docs/product/nutrition-plan.md's Phase H
// section, verified against the real screenshot (`saved meals page.png`).
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: jest.fn(),
  },
}));

jest.mock('@/auth/apiClient', () => ({
  listSavedMeals: jest.fn(),
  getFood: jest.fn(),
  deleteSavedMeal: jest.fn(),
  logSavedMeal: jest.fn(),
}));

import { deleteSavedMeal, getFood, listSavedMeals, logSavedMeal } from '@/auth/apiClient';

import SavedMealsScreen from '../saved-meals';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const BANANA_ID = '11111111-1111-4111-8111-111111111111';
const CHICKEN_ID = '22222222-2222-4222-8222-222222222222';

const banana = {
  id: BANANA_ID,
  name: 'Banana',
  category: 'fruits' as const,
  macrosPer100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  servings: [{ label: '1 medium (118g)', grams: 118 }],
  isCustom: false,
};

const chicken = {
  id: CHICKEN_ID,
  name: 'Chicken Breast (grilled)',
  category: 'protein' as const,
  macrosPer100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  servings: [{ label: '1 breast (172g)', grams: 172 }],
  isCustom: false,
};

const breakfastMeal = {
  id: 'meal-1',
  name: 'Breakfast — usual',
  items: [
    { foodId: BANANA_ID, servingLabel: '1 medium (118g)', grams: 118 },
    { foodId: CHICKEN_ID, servingLabel: '1 breast (172g)', grams: 172 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (listSavedMeals as jest.Mock).mockResolvedValue({ items: [breakfastMeal] });
  (getFood as jest.Mock).mockImplementation((id: string) =>
    Promise.resolve(id === BANANA_ID ? banana : chicken),
  );
  (deleteSavedMeal as jest.Mock).mockResolvedValue(undefined);
  (logSavedMeal as jest.Mock).mockResolvedValue({ items: [] });
});

afterEach(() => {
  cleanup();
});

describe('Saved meals list', () => {
  it('renders each meal card with its item rows and summary line', async () => {
    const { findByText } = await render(<SavedMealsScreen />);

    expect(await findByText('Breakfast — usual')).toBeTruthy();
    expect(await findByText(/2 items · 389 kcal/)).toBeTruthy();
    expect(await findByText(/Banana · 1 medium \(118g\)/)).toBeTruthy();
    expect(await findByText(/Chicken Breast \(grilled\) · 1 breast \(172g\)/)).toBeTruthy();
  });

  it('shows the honest empty state when there are no saved meals', async () => {
    (listSavedMeals as jest.Mock).mockResolvedValue({ items: [] });

    const { findByText } = await render(<SavedMealsScreen />);

    expect(
      await findByText('No saved meals yet — save one from a meal on the Nutrition tab.'),
    ).toBeTruthy();
  });

  it('the pencil icon navigates to edit-meal with the meal id', async () => {
    const { findByLabelText } = await render(<SavedMealsScreen />);
    await findByLabelText('Edit Breakfast — usual');

    fireEvent.press(await findByLabelText('Edit Breakfast — usual'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/edit-meal', params: { editMealId: 'meal-1' } });
  });

  it('the x icon deletes the meal optimistically', async () => {
    const { findByLabelText, queryByText } = await render(<SavedMealsScreen />);
    await findByLabelText('Delete Breakfast — usual');

    fireEvent.press(await findByLabelText('Delete Breakfast — usual'));

    await waitFor(() => expect(queryByText('Breakfast — usual')).toBeNull());
    expect(deleteSavedMeal).toHaveBeenCalledWith('meal-1');
  });

  it('reverts the optimistic delete on failure', async () => {
    (deleteSavedMeal as jest.Mock).mockRejectedValue(new Error('nope'));

    const { findByLabelText, findByText } = await render(<SavedMealsScreen />);
    await findByLabelText('Delete Breakfast — usual');

    fireEvent.press(await findByLabelText('Delete Breakfast — usual'));

    expect(await findByText('Breakfast — usual')).toBeTruthy();
  });

  it('opens the log-this-meal slot sheet and logs to the chosen slot', async () => {
    const { findByText, findByTestId } = await render(<SavedMealsScreen />);
    await findByText('Breakfast — usual');

    fireEvent.press(await findByText('Log this meal'));

    expect(await findByTestId('log-meal-sheet')).toBeTruthy();
    expect(await findByText('Lunch')).toBeTruthy();

    fireEvent.press(await findByText('Lunch'));
    fireEvent.press(await findByText('Log'));

    await waitFor(() =>
      expect(logSavedMeal).toHaveBeenCalledWith({
        savedMealId: 'meal-1',
        slot: 'lunch',
        loggedDate: expect.any(String),
      }),
    );
  });
});
