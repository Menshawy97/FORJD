// Whole-app review 8.5, L9a-5. The dashboard looks up each food in today's log and every saved
// meal to show its name. It passed an empty map as "foods already known" on every load, so each
// return to the screen fetched every one of those foods again, one request each. A food already
// fetched is now reused.
//
// Its own file, like nutrition-phase-h-fixes.test.tsx, to keep the module registry isolated.
import { cleanup, render as rtlRender, waitFor } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let latestFocusCallback: (() => void) | null = null;
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (callback: () => void) => {
      latestFocusCallback = callback;
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
  getMacroGoalSuggestion: jest.fn(),
  getFood: jest.fn(),
  getFoods: jest.fn(),
  deleteLogEntry: jest.fn(),
  deleteLogGroup: jest.fn(),
  createSavedMeal: jest.fn(),
  logSavedMeal: jest.fn(),
  setMacroGoals: jest.fn(),
}));

import { getFood, getMacroGoalSuggestion, getMacroGoals, listNutritionLog, listSavedMeals } from '@/auth/apiClient';
import { todayLocalDate } from '@/nutrition/date';

import NutritionScreen from '../nutrition';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const BANANA_ID = '11111111-1111-4111-8111-111111111111';
const OATS_ID = '22222222-2222-4222-8222-222222222222';
const food = (id: string, name: string) => ({
  id,
  name,
  category: 'fruits' as const,
  macrosPer100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  servings: [{ label: '100 g', grams: 100 }],
  isCustom: false,
});

const entry = {
  id: 'entry-1',
  foodId: BANANA_ID,
  loggedDate: todayLocalDate(),
  slot: 'breakfast' as const,
  servingLabel: '100 g',
  grams: 100,
  kcal: 89,
  protein: 1.1,
  carbs: 22.8,
  fat: 0.3,
  groupId: null,
  groupName: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  latestFocusCallback = null;
  (listNutritionLog as jest.Mock).mockResolvedValue({ items: [entry] });
  (listSavedMeals as jest.Mock).mockResolvedValue({
    items: [{ id: 'meal-1', name: 'Porridge', items: [{ foodId: OATS_ID, servingLabel: '100 g', grams: 100 }] }],
  });
  (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
  (getMacroGoalSuggestion as jest.Mock).mockRejectedValue(new Error('not under test'));
  (getFood as jest.Mock).mockImplementation(async (id: string) =>
    id === BANANA_ID ? food(BANANA_ID, 'Banana, raw') : food(OATS_ID, 'Oats'),
  );
});

afterEach(() => {
  cleanup();
});

it('fetches each food once, and not again when the screen regains focus', async () => {
  const { findByText } = await render(<NutritionScreen />);
  expect(await findByText('Banana, raw')).toBeTruthy();
  expect(getFood).toHaveBeenCalledTimes(2);

  latestFocusCallback?.();
  await waitFor(() => expect(listNutritionLog).toHaveBeenCalledTimes(2));

  expect(getFood).toHaveBeenCalledTimes(2);
});

it('fetches only the new food when a different one appears on revisit', async () => {
  const { findByText } = await render(<NutritionScreen />);
  expect(await findByText('Banana, raw')).toBeTruthy();

  const CHICKEN_ID = '44444444-4444-4444-8444-444444444444';
  (listNutritionLog as jest.Mock).mockResolvedValue({ items: [entry, { ...entry, id: 'entry-2', foodId: CHICKEN_ID }] });
  latestFocusCallback?.();

  await waitFor(() => expect(getFood).toHaveBeenCalledTimes(3));
  expect(getFood).toHaveBeenLastCalledWith(CHICKEN_ID);
});

// G5: the screens fetch foods with one `getFoods` call; route it through this file's per-id
// `getFood` mock so the foods each test sets up, and its call counts, still mean what they did.
beforeEach(() => {
  const api = jest.requireMock('@/auth/apiClient') as { getFood: jest.Mock; getFoods: jest.Mock };
  api.getFoods.mockImplementation((ids: string[]) => Promise.all([...new Set(ids)].map((id) => api.getFood(id))));
});
