// X3 -- Weekly Forge "How it works" (weekly-forge-explainer-plan.md; mock-up C, approved 2026-09-27).
//
// NOTE: @testing-library/react-native v14 makes render() and every fireEvent.* async.
import type { ForgeResponse } from '@forjd/contracts';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockForge: ForgeResponse | null = null;

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: () => mockBack(), replace: jest.fn() },
}));
jest.mock('@/features/forge/use-forge-week', () => ({
  useForgeWeek: () => ({ isVisible: true, forge: mockForge }),
}));

import HowItWorksScreen from '../forge/how-it-works';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

type Progress = ForgeResponse['ladders'][number];

const ladder = (name: Progress['ladder'], level: number, band: Progress['band']): Progress => ({
  ladder: name,
  unit: 'kg',
  band,
  level,
  maxLevel: 15,
  target: 1,
  total: 0,
  progress: 0,
  missStreak: 0,
  temperedHoldWeeks: 0,
  forgedStreak: 0,
  bestForgedStreak: 0,
  badges: [],
});

const WEEK: ForgeResponse = {
  weekStart: '2026-09-26',
  daysLeft: 6,
  timeZone: 'Africa/Cairo',
  ladders: [
    ladder('consistency', 6, 'forged'),
    ladder('volume', 4, 'ember'),
    ladder('distance', 5, 'ember'),
    ladder('minutes', 3, 'ore'),
    ladder('nourish', 5, 'anvil'),
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockForge = WEEK;
});

describe('HowItWorksScreen', () => {
  it('explains levels, the bands and the week, in the approved words', async () => {
    await render(<HowItWorksScreen />);

    expect(screen.getByText('How it works')).toBeTruthy();
    expect(screen.getByText(/Each week you get five goals, one per ladder\./)).toBeTruthy();
    expect(screen.getByText('The bands')).toBeTruthy();
    for (const band of ['Ore', 'Ember', 'Anvil', 'Tempered']) {
      expect(screen.getByText(band)).toBeTruthy();
    }
    expect(screen.getAllByText('Forged')).toHaveLength(2);
    expect(screen.getByText(/with 3 levels in each/)).toBeTruthy();
    expect(screen.getByText('When the week closes')).toBeTruthy();
    for (const tag of ['Up 1', 'Up to +3', 'Held']) {
      expect(screen.getByText(tag)).toBeTruthy();
    }
    expect(screen.getByText(/you ease down one level/)).toBeTruthy();
  });

  it('says what every ladder counts, with your own level, and keeps Nourish private', async () => {
    await render(<HowItWorksScreen />);

    expect(screen.getByText('What each ladder counts')).toBeTruthy();
    expect(screen.getByText('Weight × reps, warm-ups included')).toBeTruthy();
    expect(screen.getByText('Days with at least one meal logged · Only you see this')).toBeTruthy();
    expect(screen.getByText('Level 4')).toBeTruthy();
    expect(
      screen.getByLabelText('Volume, level 4. Counts weight × reps, warm-ups included. Opens all levels'),
    ).toBeTruthy();
  });

  it('shows a dash for your level until the week has loaded', async () => {
    mockForge = null;
    await render(<HowItWorksScreen />);

    expect(screen.getAllByText('—')).toHaveLength(5);
  });

  it('opens a ladder, the FAQ, and goes back', async () => {
    await render(<HowItWorksScreen />);

    await fireEvent.press(screen.getByLabelText(/^Distance, level 5/));
    expect(mockPush).toHaveBeenCalledWith('/forge/distance');

    await fireEvent.press(screen.getByRole('button', { name: 'More questions in the FAQ' }));
    expect(mockPush).toHaveBeenCalledWith('/faq');

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
