// Phase H. `food/[id].tsx`'s `onPrimary` `forMeal` branch appends the selected food to
// `MealDraftContext` instead of just returning (Phase G's stub), then pops back to
// `edit-meal.tsx` -- see food/[id].tsx's own docblock. Kept in its own file, isolated from
// `food-detail-fidelity.test.tsx`'s ten Phase G tests, since sharing a Jest module registry
// with them surfaced a `render()` returning an empty result -- traced to late-resolving
// promises from earlier tests in that file settling mid-test here and corrupting the shared
// react-test-renderer instance under `--runInBand` (the same class of leak the project's own
// "act() not configured" lesson from Phase F's `nutrition.tsx` debugging warned about). A
// fresh Jest test file gets its own module registry and renderer, sidestepping the leak
// entirely rather than chasing it down.
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
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

import { getFood } from '@/auth/apiClient';

import { MealDraftProvider, useMealDraft } from '@/features/nutrition/meal-draft-context';

import FoodDetailScreen from '../food/[id]';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

const BANANA_ID = '11111111-1111-4111-8111-111111111111';
const banana = {
  id: BANANA_ID,
  name: 'Banana, raw',
  category: 'fruits' as const,
  macrosPer100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  servings: [{ label: '1 medium (118g)', grams: 118 }],
  isCustom: false,
};

/** Standing in for edit-meal.tsx having already populated a draft via `startDraft`. Renders
 *  the item count as text so the test can assert on the shared context, not just local state. */
function MealDraftProbe() {
  const { draft, startDraft } = useMealDraft();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => startDraft({ id: 'meal-1', name: 'Breakfast — usual', items: [] })}>
        <Text>Seed draft</Text>
      </Pressable>
      <Text testID="draft-item-count">{draft ? draft.items.length : -1}</Text>
    </>
  );
}

function render(ui: ReactElement) {
  return rtlRender(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MealDraftProvider>
        <MealDraftProbe />
        {ui}
      </MealDraftProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: BANANA_ID, foodTarget: 'meal', editMealId: 'meal-1' };
  (getFood as jest.Mock).mockResolvedValue(banana);
});

afterEach(() => {
  cleanup();
});

describe('Food detail — meal mode (Phase H)', () => {
  it('adding an ingredient appends it to the MealDraftContext and pops back twice', async () => {
    const { findByText, getByTestId } = await render(<FoodDetailScreen />);

    fireEvent.press(await findByText('Seed draft'));
    await waitFor(() => expect(getByTestId('draft-item-count').props.children).toBe(0));

    fireEvent.press(await findByText('Add Ingredient'));

    await waitFor(() => expect(getByTestId('draft-item-count').props.children).toBe(1));
    expect(mockBack).toHaveBeenCalledTimes(2);
  });

  it('does nothing to the context when no draft has been started (defensive fallback)', async () => {
    const { findByText } = await render(<FoodDetailScreen />);
    await findByText('Banana, raw');

    fireEvent.press(await findByText('Add Ingredient'));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(2));
  });
});
