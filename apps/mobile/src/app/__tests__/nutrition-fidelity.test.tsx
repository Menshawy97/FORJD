// Phase F. Ports the prototype's `s_nutrition()` -- docs/design/nutrition-screen-specs.md §2,
// verified against the real screenshot (`nutrition dashboard.png`). See nutrition.tsx's own
// docblock for the two adaptations forced by Phase E's wire shapes (client-side food-name
// lookup, grouped rows rendered individually).
import { cleanup, fireEvent, render as rtlRender, waitFor, within } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
// nutrition.tsx now loads via `useFocusEffect` (Phase H's follow-up fix for stale data on
// return -- see nutrition-focus-refetch.test.tsx), not a plain mount effect -- this mock runs
// the callback once on mount so every test below still sees its initial load.
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => {
        callback();
      }, []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  listNutritionLog: jest.fn(),
  listSavedMeals: jest.fn(),
  getMacroGoals: jest.fn(),
  getFood: jest.fn(),
  deleteLogEntry: jest.fn(),
  deleteLogGroup: jest.fn(),
  createSavedMeal: jest.fn(),
  logSavedMeal: jest.fn(),
  setMacroGoals: jest.fn(),
}));

import {
  createSavedMeal,
  deleteLogEntry,
  getFood,
  getMacroGoals,
  listNutritionLog,
  listSavedMeals,
  logSavedMeal,
  setMacroGoals,
} from '@/auth/apiClient';

import { todayLocalDate } from '@/nutrition/date';

import NutritionScreen from '../nutrition';

const TODAY = todayLocalDate();

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const BANANA_ID = '11111111-1111-4111-8111-111111111111';
const banana = {
  id: BANANA_ID,
  name: 'Banana, raw',
  category: 'fruits' as const,
  macrosPer100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  servings: [{ label: '1 medium (118g)', grams: 118 }],
  isCustom: false,
};

const bananaEntry = {
  id: 'entry-1',
  foodId: BANANA_ID,
  loggedDate: TODAY,
  slot: 'breakfast' as const,
  servingLabel: '1 medium (118g)',
  grams: 118,
  kcal: 105,
  protein: 1.3,
  carbs: 26.9,
  fat: 0.35,
  groupId: null,
  groupName: null,
};

function mockEmptyDay() {
  (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
  (listSavedMeals as jest.Mock).mockResolvedValue({ items: [] });
  (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
  (getFood as jest.Mock).mockResolvedValue(banana);
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Nutrition dashboard', () => {
  it('shows an honest prompt to set goals when none have ever been saved, instead of a fabricated ring', async () => {
    mockEmptyDay();

    const { getByText, queryByText } = await render(<NutritionScreen />);

    await waitFor(() => expect(getByText('Set your daily goals')).toBeTruthy());
    expect(queryByText('/ 2400 kcal')).toBeNull();
  });

  it('renders every meal slot with an empty "+ Add food" row when the day has no entries', async () => {
    mockEmptyDay();

    const { getAllByText, queryByText } = await render(<NutritionScreen />);

    await waitFor(() => expect(getAllByText('Add food').length).toBe(4));
    // No per-slot empty-state string exists, per the design spec -- just the label and the link.
    expect(queryByText(/no items/i)).toBeNull();
  });

  it('renders a logged item with its real food name, resolved client-side via getFood', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [bananaEntry] });
    (listSavedMeals as jest.Mock).mockResolvedValue({ items: [] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockResolvedValue(banana);

    const { getByText, getAllByText } = await render(<NutritionScreen />);

    await waitFor(() => expect(getByText('Banana, raw')).toBeTruthy());
    expect(getByText('1 medium (118g)')).toBeTruthy();
    // "105 kcal" appears twice -- the item row and the Breakfast section's own subtotal,
    // since this is the section's only item.
    expect(getAllByText('105 kcal').length).toBeGreaterThan(0);
    expect(getFood).toHaveBeenCalledWith(BANANA_ID);
  });

  it('deletes an item optimistically and calls deleteLogEntry', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [bananaEntry] });
    (listSavedMeals as jest.Mock).mockResolvedValue({ items: [] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockResolvedValue(banana);
    (deleteLogEntry as jest.Mock).mockResolvedValue(undefined);

    const { getByText, getByLabelText, queryByText } = await render(<NutritionScreen />);
    await waitFor(() => expect(getByText('Banana, raw')).toBeTruthy());

    fireEvent.press(getByLabelText('Remove Banana, raw'));

    await waitFor(() => expect(queryByText('Banana, raw')).toBeNull());
    expect(deleteLogEntry).toHaveBeenCalledWith('entry-1');
  });

  it('opens the Save as meal sheet prefilled with "<Slot> — usual" and saves it', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [bananaEntry] });
    (listSavedMeals as jest.Mock).mockResolvedValue({ items: [] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockResolvedValue(banana);
    (createSavedMeal as jest.Mock).mockResolvedValue({ id: 'meal-1', name: 'Breakfast — usual', items: [] });

    const { getByText, getByDisplayValue } = await render(<NutritionScreen />);
    await waitFor(() => expect(getByText('Save as meal')).toBeTruthy());

    fireEvent.press(getByText('Save as meal'));

    await waitFor(() => expect(getByText('Save Breakfast as a meal')).toBeTruthy());
    expect(getByDisplayValue('Breakfast — usual')).toBeTruthy();

    fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(createSavedMeal).toHaveBeenCalledWith({
        name: 'Breakfast — usual',
        items: [{ foodId: BANANA_ID, servingLabel: '1 medium (118g)', grams: 118 }],
      }),
    );
  });

  it('opens the Log meal sheet from the saved meals strip, switches slot, and logs it', async () => {
    const meal = {
      id: 'meal-1',
      name: 'Breakfast — usual',
      items: [{ foodId: BANANA_ID, servingLabel: '1 medium (118g)', grams: 118 }],
    };
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
    (listSavedMeals as jest.Mock).mockResolvedValue({ items: [meal] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockResolvedValue(banana);
    (logSavedMeal as jest.Mock).mockResolvedValue({ items: [{ ...bananaEntry, slot: 'lunch', groupId: 'g1' }] });

    const { getByText, getByTestId } = await render(<NutritionScreen />);
    await waitFor(() => expect(getByText('Log')).toBeTruthy());

    fireEvent.press(getByText('Log'));
    await waitFor(() => expect(getByText('Log "Breakfast — usual"')).toBeTruthy());

    // "Lunch" and "Log" both also name elements outside the sheet (the meal-section header,
    // the strip's own pill) -- scope into the sheet itself to press the right ones.
    const sheet = within(getByTestId('log-meal-sheet'));
    fireEvent.press(sheet.getByText('Lunch'));
    // Let the slot-selection state update commit before pressing Log -- otherwise Log's
    // onPress closure can still be the one bound before the Lunch press's re-render.
    await waitFor(() => expect(sheet.getByText('Lunch')).toBeTruthy());
    fireEvent.press(sheet.getByText('Log'));

    await waitFor(() =>
      expect(logSavedMeal).toHaveBeenCalledWith({ savedMealId: 'meal-1', slot: 'lunch', loggedDate: TODAY }),
    );
  });

  it('opens Set daily goals via the target icon and rejects an invalid save', async () => {
    mockEmptyDay();

    const { getByLabelText, getByText } = await render(<NutritionScreen />);
    await waitFor(() => expect(getByText('Set your daily goals')).toBeTruthy());

    fireEvent.press(getByLabelText('Set daily goals'));

    await waitFor(() => expect(getByText('Set daily goals')).toBeTruthy());

    fireEvent.press(getByText('Save'));

    expect(setMacroGoals).not.toHaveBeenCalled();
  });

  it('navigates to the share and saved-meals placeholders from the header icons', async () => {
    mockEmptyDay();

    const { getByLabelText, getByText } = await render(<NutritionScreen />);
    await waitFor(() => expect(getByText('Set your daily goals')).toBeTruthy());

    fireEvent.press(getByLabelText('Share nutrition'));
    expect(mockPush).toHaveBeenCalledWith('/nutrition-share');

    fireEvent.press(getByLabelText('Saved meals'));
    expect(mockPush).toHaveBeenCalledWith('/saved-meals');
  });
});
