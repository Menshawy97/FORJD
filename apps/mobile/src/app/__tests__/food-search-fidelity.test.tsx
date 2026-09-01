// Phase G. Ports the prototype's `s_foodSearch()` -- docs/design/nutrition-screen-specs.md §3,
// verified against the real screenshot (`FORJD mobile app design/screenshots/
// searchfoodalsoaddfood.png`). See food-search.tsx's own docblock for the adaptations forced by
// the real wire shapes (debounced server-side search, the new custom-food category chip row).
//
// The 300ms debounce is exercised with real timers via RTL's own polling helpers
// (`findBy*`/`waitFor`, both real-time by default) rather than fake timers -- advancing fake
// timers only fires the `setTimeout` callback, it does not force the mocked promise's `.then()`
// microtask to resolve in lockstep with a manually-driven `act()`, which produced flaky
// "overlapping act()" failures when tried here.
import { act, cleanup, fireEvent, render as rtlRender, waitFor, within } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = { slot: 'breakfast' };

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/auth/apiClient', () => ({
  searchFoods: jest.fn(),
  createCustomFood: jest.fn(),
}));

import { createCustomFood, searchFoods } from '@/auth/apiClient';

import FoodSearchScreen from '../food-search';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const DEBOUNCE_WAIT = { timeout: 3000 };

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

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { slot: 'breakfast' };
});

afterEach(() => {
  cleanup();
});

describe('Food search', () => {
  it('debounces the search and renders a result with the first-serving kcal', async () => {
    (searchFoods as jest.Mock).mockResolvedValue({ items: [banana] });

    const { findByText, queryByText } = await render(<FoodSearchScreen />);

    // Not yet resolved immediately after mount -- the debounce window has not elapsed.
    expect(queryByText('Banana, raw')).toBeNull();

    expect(await findByText('Banana, raw', {}, DEBOUNCE_WAIT)).toBeTruthy();
    expect(await findByText('Fruits · 1 medium (118g)')).toBeTruthy();
    expect(await findByText('105 kcal')).toBeTruthy();
    expect(searchFoods).toHaveBeenLastCalledWith('', undefined);
  });

  it('filters by category chip', async () => {
    (searchFoods as jest.Mock).mockResolvedValue({ items: [] });
    const { getByText } = await render(<FoodSearchScreen />);
    await waitFor(() => expect(searchFoods).toHaveBeenLastCalledWith('', undefined), DEBOUNCE_WAIT);

    fireEvent.press(getByText('Protein'));

    await waitFor(() => expect(searchFoods).toHaveBeenLastCalledWith('', 'protein'), DEBOUNCE_WAIT);
  });

  it('shows the exact echoed query in the empty state', async () => {
    (searchFoods as jest.Mock).mockResolvedValue({ items: [] });
    const { getByPlaceholderText, findByText } = await render(<FoodSearchScreen />);
    await waitFor(() => expect(searchFoods).toHaveBeenLastCalledWith('', undefined), DEBOUNCE_WAIT);

    fireEvent.changeText(getByPlaceholderText('Search foods…'), 'zzz');

    expect(await findByText('No foods match "zzz"', {}, DEBOUNCE_WAIT)).toBeTruthy();
  });

  it('shows the contextual header title for slot mode', async () => {
    (searchFoods as jest.Mock).mockResolvedValue({ items: [] });
    const { findByText } = await render(<FoodSearchScreen />);

    // The header title is derived from route params, not search results -- it does not need
    // to wait on the debounce window at all.
    expect(await findByText('Add to Breakfast')).toBeTruthy();
  });

  it('navigates to food detail with the slot param when tapping a result', async () => {
    (searchFoods as jest.Mock).mockResolvedValue({ items: [banana] });
    const { findByText } = await render(<FoodSearchScreen />);

    fireEvent.press(await findByText('Banana, raw', {}, DEBOUNCE_WAIT));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/food/[id]', params: { id: BANANA_ID, slot: 'breakfast' } });
  });

  it('navigates to food detail with meal-target params in meal mode', async () => {
    mockParams = { foodTarget: 'meal', editMealId: 'meal-1' };
    (searchFoods as jest.Mock).mockResolvedValue({ items: [banana] });
    const { findByText } = await render(<FoodSearchScreen />);

    fireEvent.press(await findByText('Banana, raw', {}, DEBOUNCE_WAIT));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/food/[id]',
      params: { id: BANANA_ID, foodTarget: 'meal', editMealId: 'meal-1' },
    });
  });

  it('redirects to nutrition when neither a slot nor a meal target is given', async () => {
    mockParams = {};
    await render(<FoodSearchScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/nutrition'));
  });

  it('opens the custom-food sheet, requires name and category, and saves it', async () => {
    (searchFoods as jest.Mock).mockResolvedValue({ items: [] });
    (createCustomFood as jest.Mock).mockResolvedValue({
      ...banana,
      id: 'custom-1',
      name: 'Peanut Butter Balls',
      category: 'protein',
    });

    const { getByLabelText, findByText, getByTestId } = await render(<FoodSearchScreen />);

    fireEvent.press(getByLabelText('Add custom food'));
    await findByText('Add custom food');

    const sheet = within(getByTestId('custom-food-sheet'));

    // Empty name -> real toast validation, no silent no-op. Toast renders outside the sheet's
    // own container (a sibling at the screen root), so it is queried unscoped.
    fireEvent.press(sheet.getByText('Add Food'));
    expect(createCustomFood).not.toHaveBeenCalled();
    expect(await findByText('Enter a food name')).toBeTruthy();

    // `fireEvent.changeText` schedules the state update but does not necessarily flush it
    // before the very next `fireEvent` call -- an `act()` boundary around each step forces the
    // pending update to land before the following press reads it, otherwise the press can fire
    // against a still-stale closure (confirmed live: without this, the second "Add Food" press
    // below observed `customFood.name` as still `""`).
    await act(async () => {
      fireEvent.changeText(sheet.getByPlaceholderText('Food name'), 'Peanut Butter Balls');
    });
    await act(async () => {
      fireEvent.press(sheet.getByText('Add Food'));
    });
    expect(createCustomFood).not.toHaveBeenCalled();
    expect(await findByText('Choose a category')).toBeTruthy();

    // "Protein" is ambiguous as plain text -- it is both the category chip label AND the
    // macro row label ("Protein" grams). Query by role to target the chip specifically.
    await act(async () => {
      fireEvent.press(sheet.getByRole('button', { name: 'Protein' }));
    });
    await act(async () => {
      fireEvent.press(sheet.getByText('Add Food'));
    });

    await waitFor(() =>
      expect(createCustomFood).toHaveBeenCalledWith({
        name: 'Peanut Butter Balls',
        category: 'protein',
        kcalPer100g: 0,
        proteinPer100g: 0,
        carbsPer100g: 0,
        fatPer100g: 0,
      }),
    );
    expect(await findByText('Added Peanut Butter Balls to your foods')).toBeTruthy();
  });
});
