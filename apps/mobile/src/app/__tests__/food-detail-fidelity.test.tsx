// Phase G. Ports the prototype's `s_foodDetail()` -- docs/design/nutrition-screen-specs.md §4,
// verified against the real screenshot (`FORJD mobile app design/screenshots/fooddetails.png`).
// See food/[id].tsx's own docblock for the adaptations forced by the real wire shapes (no PATCH
// endpoint -- edit is delete-then-recreate; quantity has no wire column, so it is baked into the
// saved servingLabel text).
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
  getFood: jest.fn(),
  listNutritionLog: jest.fn(),
  logFood: jest.fn(),
  deleteLogEntry: jest.fn(),
}));

import { deleteLogEntry, getFood, listNutritionLog, logFood } from '@/auth/apiClient';

import FoodDetailScreen from '../food/[id]';

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
  servings: [
    { label: '1 medium (118g)', grams: 118 },
    { label: '100 g', grams: 100 },
  ],
  isCustom: false,
};

const bananaEntry = {
  id: 'entry-1',
  foodId: BANANA_ID,
  loggedDate: '2026-09-01',
  slot: 'breakfast' as const,
  servingLabel: '1 medium (118g)',
  grams: 118,
  kcal: 105,
  protein: 1.3,
  carbs: 26.9,
  fat: 0.35,
  groupId: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  (getFood as jest.Mock).mockResolvedValue(banana);
  (listNutritionLog as jest.Mock).mockResolvedValue({ items: [bananaEntry] });
});

afterEach(() => {
  cleanup();
});

describe('Food detail', () => {
  it('renders the macro card and every serving', async () => {
    mockParams = { id: BANANA_ID, slot: 'breakfast' };

    const { findByText, getByTestId } = await render(<FoodDetailScreen />);

    expect(await findByText('Banana, raw')).toBeTruthy();
    expect(await findByText('Fruits')).toBeTruthy();
    await waitFor(() => expect(getByTestId('detail-kcal').props.children).toBe(105));
    expect(await findByText('1 medium (118g)')).toBeTruthy();
    expect(await findByText('100 g')).toBeTruthy();
    expect(await findByText('Custom amount')).toBeTruthy();
  });

  it('updates the kcal numeral when a different serving is selected', async () => {
    mockParams = { id: BANANA_ID, slot: 'breakfast' };

    const { findByText, getByTestId } = await render(<FoodDetailScreen />);
    await waitFor(() => expect(getByTestId('detail-kcal').props.children).toBe(105));

    fireEvent.press(await findByText('100 g'));

    await waitFor(() => expect(getByTestId('detail-kcal').props.children).toBe(89));
  });

  it('selecting Custom amount hides the quantity stepper and reveals the grams input', async () => {
    mockParams = { id: BANANA_ID, slot: 'breakfast' };

    const { findByText, queryByText, getByPlaceholderText } = await render(<FoodDetailScreen />);
    await findByText('Banana, raw');

    expect(await findByText('Quantity')).toBeTruthy();

    fireEvent.press(await findByText('Custom amount'));

    await waitFor(() => expect(queryByText('Quantity')).toBeNull());
    expect(getByPlaceholderText('0')).toBeTruthy();
  });

  it('the quantity stepper never goes below 1', async () => {
    mockParams = { id: BANANA_ID, slot: 'breakfast' };

    const { findByText, getByTestId, getByLabelText } = await render(<FoodDetailScreen />);
    await findByText('Banana, raw');

    fireEvent.press(getByLabelText('Decrease quantity'));

    expect(getByTestId('detail-qty').props.children).toBe(1);
  });

  it('hides the "Log as" slot chips when in meal-target mode', async () => {
    mockParams = { id: BANANA_ID, foodTarget: 'meal' };

    const { findByText, queryByText } = await render(<FoodDetailScreen />);
    await findByText('Banana, raw');

    expect(queryByText('Log as')).toBeNull();
    expect(await findByText('Add Ingredient')).toBeTruthy();
  });

  it('new-log save calls logFood and flashes Logged <name> — <Slot>', async () => {
    mockParams = { id: BANANA_ID, slot: 'breakfast' };
    (logFood as jest.Mock).mockResolvedValue(bananaEntry);

    const { findByText, getByText } = await render(<FoodDetailScreen />);
    await findByText('Banana, raw');

    fireEvent.press(getByText('Add to Log'));

    await waitFor(() =>
      expect(logFood).toHaveBeenCalledWith({
        foodId: BANANA_ID,
        slot: 'breakfast',
        loggedDate: expect.any(String),
        servingLabel: '1 medium (118g)',
        grams: 118,
      }),
    );
    expect(deleteLogEntry).not.toHaveBeenCalled();
    expect(await findByText('Logged Banana, raw — Breakfast')).toBeTruthy();
    expect(mockReplace).toHaveBeenCalledWith('/nutrition');
  });

  it('edit-mode save calls deleteLogEntry then logFood and flashes Updated <name> — <Slot>', async () => {
    mockParams = { id: BANANA_ID, entryId: 'entry-1', slot: 'breakfast' };
    (deleteLogEntry as jest.Mock).mockResolvedValue(undefined);
    (logFood as jest.Mock).mockResolvedValue(bananaEntry);

    const { findByText, getByText } = await render(<FoodDetailScreen />);
    await findByText('Save Changes');

    // The preselected serving comes from the real entry, fetched via listNutritionLog since
    // there is no per-entry GET endpoint -- confirms the docblock's stated adaptation.
    expect(listNutritionLog).toHaveBeenCalledWith(expect.any(String));

    fireEvent.press(getByText('Save Changes'));

    await waitFor(() => expect(deleteLogEntry).toHaveBeenCalledWith('entry-1'));
    expect(logFood).toHaveBeenCalledWith({
      foodId: BANANA_ID,
      slot: 'breakfast',
      loggedDate: expect.any(String),
      servingLabel: '1 medium (118g)',
      grams: 118,
    });
    expect(await findByText('Updated Banana, raw — Breakfast')).toBeTruthy();
  });

  it('shows Remove Entry only in edit mode and calls deleteLogEntry', async () => {
    mockParams = { id: BANANA_ID, entryId: 'entry-1', slot: 'breakfast' };
    (deleteLogEntry as jest.Mock).mockResolvedValue(undefined);

    const { findByText, getByText } = await render(<FoodDetailScreen />);
    await findByText('Remove Entry');

    fireEvent.press(getByText('Remove Entry'));

    await waitFor(() => expect(deleteLogEntry).toHaveBeenCalledWith('entry-1'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/nutrition'));
  });

  it('does not show Remove Entry in new-log mode', async () => {
    mockParams = { id: BANANA_ID, slot: 'breakfast' };

    const { findByText, queryByText } = await render(<FoodDetailScreen />);
    await findByText('Add to Log');

    expect(queryByText('Remove Entry')).toBeNull();
  });

  it('redirects to nutrition when no id param is present', async () => {
    mockParams = { slot: 'breakfast' };

    await render(<FoodDetailScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/nutrition'));
  });
});
