// Phase H follow-up fixes -- four real bugs found live on a physical device against the merged
// Phase H code, see docs/product/nutrition-plan.md's addendum for the full writeup:
//   1. duplicate saved-meal names were allowed with no error
//   2. the dashboard's Saved Meals section went stale after a delete on another screen
//   3. logging a saved meal was unreliable (no double-submit guard; a failed post-log refresh
//      could silently overwrite the "Logged..." success toast with a generic error)
//   4. grouped log entries rendered individually instead of collapsed, per the design
//
// Kept in its own file, isolated from `nutrition-fidelity.test.tsx`'s eight Phase F tests --
// sharing that file's Jest module registry reproduced the same `--runInBand` state-bleed this
// project already traced once before (Phase H's own `food-detail-meal-mode.test.tsx`, see that
// file's docblock): later-resolving promises from earlier tests settled mid-test here and left
// the shared react-test-renderer unable to find basic content that rendered fine in isolation.
import { cleanup, fireEvent, render as rtlRender, waitFor, within } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
// Captures the latest callback registered via `useFocusEffect` so a test can simulate the
// screen regaining focus by invoking it a second time -- react-navigation's real hook runs the
// callback on every focus (including the initial mount), which this mirrors via a plain mount
// effect plus an escape hatch a test can call manually.
let latestFocusCallback: (() => void) | null = null;
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
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
  getFood: jest.fn(),
  deleteLogEntry: jest.fn(),
  deleteLogGroup: jest.fn(),
  createSavedMeal: jest.fn(),
  logSavedMeal: jest.fn(),
  setMacroGoals: jest.fn(),
}));

import {
  createSavedMeal,
  deleteLogGroup,
  getFood,
  getMacroGoals,
  listNutritionLog,
  listSavedMeals,
  logSavedMeal,
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

beforeEach(() => {
  jest.clearAllMocks();
  latestFocusCallback = null;
});

afterEach(() => {
  cleanup();
});

describe('bug 2: stale saved-meals list', () => {
  it('refetches everything when the screen regains focus, not just on mount', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockResolvedValue(banana);
    (listSavedMeals as jest.Mock)
      .mockResolvedValueOnce({ items: [{ id: 'meal-1', name: 'Breakfast — usual', items: [] }] })
      .mockResolvedValueOnce({ items: [] });

    const { findByText, queryByText } = await render(<NutritionScreen />);
    expect(await findByText('Breakfast — usual')).toBeTruthy();

    // Simulate navigating back to this screen after deleting the meal on saved-meals.tsx --
    // react-navigation would re-run the useFocusEffect callback; the test mock exposes it here.
    latestFocusCallback?.();

    await waitFor(() => expect(queryByText('Breakfast — usual')).toBeNull());
    expect(listSavedMeals).toHaveBeenCalledTimes(2);
  });
});

describe('bug 1: duplicate saved-meal names', () => {
  it('shows a real conflict message on a 409, not a generic one, and does not close the sheet', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [bananaEntry] });
    (listSavedMeals as jest.Mock).mockResolvedValue({ items: [] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockResolvedValue(banana);
    (createSavedMeal as jest.Mock).mockRejectedValue({ response: { status: 409 } });

    const { getByText, findByText } = await render(<NutritionScreen />);
    await waitFor(() => expect(getByText('Save as meal')).toBeTruthy());
    fireEvent.press(getByText('Save as meal'));
    await waitFor(() => expect(getByText('Save Breakfast as a meal')).toBeTruthy());

    fireEvent.press(getByText('Save'));

    expect(await findByText('You already have a saved meal named "Breakfast — usual".')).toBeTruthy();
    // The sheet stays open so the user can just edit the name and retry.
    expect(getByText('Save Breakfast as a meal')).toBeTruthy();
  });
});

describe('bug 3: unreliable log-a-saved-meal', () => {
  it('disables the Log button while a request is in flight, so a second tap cannot fire a duplicate log', async () => {
    const meal = {
      id: 'meal-1',
      name: 'Breakfast — usual',
      items: [{ foodId: BANANA_ID, servingLabel: '1 medium (118g)', grams: 118 }],
    };
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
    (listSavedMeals as jest.Mock).mockResolvedValue({ items: [meal] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockResolvedValue(banana);
    let resolveLog: (() => void) | undefined;
    (logSavedMeal as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveLog = () => resolve({ items: [{ ...bananaEntry, slot: 'breakfast', groupId: 'g1' }] });
      }),
    );

    const { getByText, getByTestId } = await render(<NutritionScreen />);
    await waitFor(() => expect(getByText('Log')).toBeTruthy());
    fireEvent.press(getByText('Log'));
    await waitFor(() => expect(getByText('Log "Breakfast — usual"')).toBeTruthy());

    const sheet = within(getByTestId('log-meal-sheet'));
    fireEvent.press(sheet.getByText('Log'));
    // Still mid-flight: the button now reads "Logging…" and a second tap is a no-op.
    await waitFor(() => expect(sheet.getByText('Logging…')).toBeTruthy());
    fireEvent.press(sheet.getByText('Logging…'));

    resolveLog?.();
    await waitFor(() => expect(logSavedMeal).toHaveBeenCalledTimes(1));
  });

  it('gives a compound message when the log succeeds but the post-log refresh fails, instead of a generic one that looks like the log itself failed', async () => {
    const meal = {
      id: 'meal-1',
      name: 'Breakfast — usual',
      items: [{ foodId: BANANA_ID, servingLabel: '1 medium (118g)', grams: 118 }],
    };
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
    (listSavedMeals as jest.Mock).mockResolvedValueOnce({ items: [meal] }).mockRejectedValueOnce(new Error('boom'));
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockResolvedValue(banana);
    (logSavedMeal as jest.Mock).mockResolvedValue({
      items: [{ ...bananaEntry, slot: 'breakfast', groupId: 'g1' }],
    });

    const { getByText, getByTestId, findByText } = await render(<NutritionScreen />);
    await waitFor(() => expect(getByText('Log')).toBeTruthy());
    fireEvent.press(getByText('Log'));
    await waitFor(() => expect(getByText('Log "Breakfast — usual"')).toBeTruthy());

    fireEvent.press(within(getByTestId('log-meal-sheet')).getByText('Log'));

    expect(
      await findByText(
        'Logged "Breakfast — usual" to Breakfast, but the dashboard couldn\'t refresh — pull down or reopen to see it.',
      ),
    ).toBeTruthy();
  });
});

describe('bug 4: grouped log rows', () => {
  it('renders grouped log entries as one collapsed row, expands on tap, and deletes the whole group', async () => {
    const CHICKEN_ID = '22222222-2222-4222-8222-222222222222';
    const chicken = {
      id: CHICKEN_ID,
      name: 'Chicken Breast',
      category: 'protein' as const,
      macrosPer100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
      servings: [{ label: '1 breast (172g)', grams: 172 }],
      isCustom: false,
    };
    const groupedEntries = [
      { ...bananaEntry, id: 'g-entry-1', groupId: 'group-1', groupName: 'Breakfast — usual' },
      {
        ...bananaEntry,
        id: 'g-entry-2',
        foodId: CHICKEN_ID,
        servingLabel: '1 breast (172g)',
        kcal: 284,
        groupId: 'group-1',
        groupName: 'Breakfast — usual',
      },
    ];
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: groupedEntries });
    (listSavedMeals as jest.Mock).mockResolvedValue({ items: [] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    (getFood as jest.Mock).mockImplementation((id: string) =>
      Promise.resolve(id === CHICKEN_ID ? chicken : banana),
    );
    (deleteLogGroup as jest.Mock).mockResolvedValue(undefined);

    const { findByText, queryByText, getByLabelText } = await render(<NutritionScreen />);

    expect(await findByText('Breakfast — usual')).toBeTruthy();
    expect(await findByText(/2 items · tap to view/)).toBeTruthy();
    // Collapsed: individual item names are not shown yet.
    expect(queryByText('Chicken Breast')).toBeNull();

    fireEvent.press(await findByText('Breakfast — usual'));

    expect(await findByText('Chicken Breast')).toBeTruthy();
    expect(await findByText(/2 items · tap to collapse/)).toBeTruthy();

    fireEvent.press(getByLabelText('Remove Breakfast — usual'));

    await waitFor(() => expect(queryByText('Breakfast — usual')).toBeNull());
    expect(deleteLogGroup).toHaveBeenCalledWith('group-1');
  });
});
