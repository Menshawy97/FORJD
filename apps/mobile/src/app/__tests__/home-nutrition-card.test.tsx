// Nutrition Phase I -- the "Nutrition Today" card on Home. `nutrition-plan.md` sequenced this
// last of the nutrition screens and said outright that "if Home has been built by then, this
// folds into that work instead", which is what happened: the card ships as part of the Home
// dashboard rather than as a phase of its own.
//
// Prototype bindings (FORJD Mobile.dc.html lines 3911-3914): totals are summed over all four
// meal slots for today, the ring is `138.2 * (1 - min(1, kcal/goal))`, and the label is
// `"<kcal> / <goal> kcal"`. The one deliberate divergence is the no-goals case: the prototype
// divides by `macroGoals.kcal` unconditionally because its goals are seeded demo state, while
// a real account can have none -- and inventing a 2400 kcal denominator to fill the gap is
// exactly the fabricated default `nutrition.tsx` already refuses to show.
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
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
  getMe: jest.fn(),
  listNutritionLog: jest.fn(),
  getMacroGoals: jest.fn(),
}));

import { getMacroGoals, getMe, listNutritionLog } from '@/auth/apiClient';
import { todayLocalDate } from '@/nutrition/date';

import HomeScreen from '../(tabs)/index';

const TODAY = todayLocalDate();

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const ME = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'james@example.com',
  profile: { displayName: 'James Mitchell' },
  privacy: {},
};

let entrySeq = 0;
function entry(slot: string, macros: { kcal: number; protein: number; carbs: number; fat: number }) {
  entrySeq += 1;
  return {
    id: `entry-${entrySeq}`,
    foodId: '11111111-1111-4111-8111-111111111111',
    loggedDate: TODAY,
    slot,
    servingLabel: '100 g',
    grams: 100,
    groupId: null,
    groupName: null,
    ...macros,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  entrySeq = 0;
  (getMe as jest.Mock).mockResolvedValue(ME);
  (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
  (getMacroGoals as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe('Nutrition Today card', () => {
  it("reads today's log, in the device's own local calendar day", async () => {
    await render(<HomeScreen />);

    await waitFor(() => expect(listNutritionLog).toHaveBeenCalledWith(TODAY));
  });

  it('shows zero with no denominator when nothing is logged and no goals are set', async () => {
    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(listNutritionLog).toHaveBeenCalled());

    expect(screen.getByText('Nutrition today')).toBeTruthy();
    expect(screen.getByText('0 kcal')).toBeTruthy();
    expect(screen.getByText('Protein 0g')).toBeTruthy();
    expect(screen.getByText('Carbs 0g')).toBeTruthy();
    expect(screen.getByText('Fat 0g')).toBeTruthy();
  });

  it('sums every meal slot logged today, not just one', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({
      items: [
        entry('breakfast', { kcal: 300, protein: 20, carbs: 30, fat: 8 }),
        entry('lunch', { kcal: 450, protein: 35, carbs: 40, fat: 12 }),
        entry('dinner', { kcal: 500, protein: 40, carbs: 45, fat: 15 }),
        entry('snack', { kcal: 150, protein: 5, carbs: 20, fat: 5 }),
      ],
    });

    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('1400 kcal')).toBeTruthy());
    expect(screen.getByText('Protein 100g')).toBeTruthy();
    expect(screen.getByText('Carbs 135g')).toBeTruthy();
    expect(screen.getByText('Fat 40g')).toBeTruthy();
  });

  it('shows the goal as a denominator once goals exist', async () => {
    (getMacroGoals as jest.Mock).mockResolvedValue({ kcal: 2400, protein: 180, carbs: 250, fat: 70 });
    (listNutritionLog as jest.Mock).mockResolvedValue({
      items: [entry('breakfast', { kcal: 450, protein: 30, carbs: 55, fat: 12 })],
    });

    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('450 / 2400 kcal')).toBeTruthy());
  });

  // Macros round for display, the same way the prototype's `Math.round` does -- a 118g banana
  // is 1.298g of protein on the wire, and "Protein 1.298g" is not a thing anyone wants to read.
  it('rounds fractional macros for display', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({
      items: [entry('breakfast', { kcal: 104.99, protein: 1.298, carbs: 26.904, fat: 0.354 })],
    });

    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('105 kcal')).toBeTruthy());
    expect(screen.getByText('Protein 1g')).toBeTruthy();
    expect(screen.getByText('Carbs 27g')).toBeTruthy();
    expect(screen.getByText('Fat 0g')).toBeTruthy();
  });

  it('opens the nutrition screen when tapped', async () => {
    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(listNutritionLog).toHaveBeenCalled());
    fireEvent.press(screen.getByLabelText('Nutrition today'));

    expect(mockPush).toHaveBeenCalledWith('/nutrition');
  });

  // A missing goals row is a normal state, not an error: `getMacroGoals` is allowed to reject
  // and the card must still render its own totals.
  it('still renders totals when the goals request fails', async () => {
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('nope'));
    (listNutritionLog as jest.Mock).mockResolvedValue({
      items: [entry('lunch', { kcal: 600, protein: 40, carbs: 60, fat: 20 })],
    });

    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('600 kcal')).toBeTruthy());
  });

  // Offline is the one failure the whole screen has to survive: Home is the launch screen, so
  // a rejected request must not take the dashboard down with it.
  it('renders the dashboard when every request fails', async () => {
    (getMe as jest.Mock).mockRejectedValue(new Error('offline'));
    (listNutritionLog as jest.Mock).mockRejectedValue(new Error('offline'));
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('offline'));

    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(listNutritionLog).toHaveBeenCalled());
    expect(screen.getByText('FORJD')).toBeTruthy();
    expect(screen.getByText('0 kcal')).toBeTruthy();
    expect(screen.getByText('Start Workout')).toBeTruthy();
  });
});
