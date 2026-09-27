// X3 -- a Weekly Forge ladder's levels (weekly-forge-explainer-plan.md D5; mock-ups D and E,
// approved 2026-09-27). Share and the celebration replay arrive in X4.
//
// NOTE: @testing-library/react-native v14 makes render() and every fireEvent.* async.
import type { ForgeResponse } from '@forjd/contracts';
import { maxLevelOf, targetOf, type ForgeLadder } from '@forjd/domain';
import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { ladder?: string } = {};
let mockWeek: { forge: ForgeResponse | null; loadFailed: boolean } = { forge: null, loadFailed: false };

jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/forge/use-forge-week', () => ({
  useForgeWeek: () => ({ isVisible: true, reload: jest.fn(), ...mockWeek }),
}));

import ForgeLadderScreen from '../forge/[ladder]';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

type Progress = ForgeResponse['ladders'][number];

const UNITS: Record<ForgeLadder, Progress['unit']> = {
  consistency: 'workouts',
  volume: 'kg',
  distance: 'km',
  minutes: 'minutes',
  nourish: 'days',
};

const progress = (ladder: ForgeLadder, level: number, band: Progress['band'], total: number): Progress => ({
  ladder,
  unit: UNITS[ladder],
  band,
  level,
  maxLevel: maxLevelOf(ladder),
  target: targetOf(ladder, level),
  total,
  progress: Math.min(1, total / targetOf(ladder, level)),
  missStreak: 0,
  temperedHoldWeeks: 0,
  forgedStreak: band === 'forged' ? 2 : 0,
  bestForgedStreak: band === 'forged' ? 2 : 0,
  badges: [],
});

const week = (...ladders: Progress[]): ForgeResponse => ({
  weekStart: '2026-09-26',
  daysLeft: 6,
  timeZone: 'Africa/Cairo',
  ladders,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { ladder: 'volume' };
  mockWeek = { forge: week(progress('volume', 4, 'ember', 6250)), loadFailed: false };
});

describe('ForgeLadderScreen', () => {
  it('shows your band, level, this week and what it will do (mock-up D)', async () => {
    await render(<ForgeLadderScreen />);

    expect(screen.getByText('Volume')).toBeTruthy();
    expect(screen.getByText('Ember · Level 4')).toBeTruthy();
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.getByText('/ 5,500 kg')).toBeTruthy();
    expect(
      screen.getByText('6,250 kg takes you to level 5 on Saturday. Reach 10,000 kg by Friday to jump to level 6.'),
    ).toBeTruthy();
  });

  it('lists all 15 levels by band, marking yours and the next one', async () => {
    await render(<ForgeLadderScreen />);

    expect(screen.getAllByText(/^Level \d+$/)).toHaveLength(15);
    for (const [band, range] of [
      ['Ore', 'Levels 1–3'],
      ['Ember', 'Levels 4–6'],
      ['Anvil', 'Levels 7–9'],
      ['Tempered', 'Levels 10–12'],
      ['Forged', 'Levels 13–15'],
    ] as const) {
      expect(screen.getByText(band)).toBeTruthy();
      expect(screen.getByText(range)).toBeTruthy();
    }
    expect(screen.getByText('75,000 kg a week')).toBeTruthy();
    expect(within(screen.getByLabelText('Level 4, 5,500 kg a week, your level')).getByText('You')).toBeTruthy();
    expect(within(screen.getByLabelText('Level 5, 7,500 kg a week, next')).getByText('Next')).toBeTruthy();
    expect(screen.getByText('Reached after 4 weeks in a row in Tempered.')).toBeTruthy();
  });

  it('shows the short Consistency ladder and says how to stay Forged (mock-up E)', async () => {
    mockParams = { ladder: 'consistency' };
    mockWeek = { forge: week(progress('consistency', 6, 'forged', 1)), loadFailed: false };
    await render(<ForgeLadderScreen />);

    expect(screen.getByText('Forged · Level 6')).toBeTruthy();
    expect(screen.getByText('Levels 1–2')).toBeTruthy();
    // A one-level band: "Level 3" is both the band's range and its only row.
    expect(screen.getAllByText('Level 3')).toHaveLength(2);
    expect(screen.getByText('1 workout a week')).toBeTruthy();
    expect(screen.getByText("You're Forged. Finish 6 workouts by Friday to stay Forged. 1 done so far.")).toBeTruthy();
  });

  it('ends Nourish at Anvil and says so (mock-up E)', async () => {
    mockParams = { ladder: 'nourish' };
    mockWeek = { forge: week(progress('nourish', 5, 'anvil', 0)), loadFailed: false };
    await render(<ForgeLadderScreen />);

    expect(screen.queryByText('Tempered')).toBeNull();
    expect(screen.getByText('6 days a week')).toBeTruthy();
    expect(screen.getByText('Nourish ends at Anvil: 6 days a week is the top, with no Tempered or Forged.')).toBeTruthy();
  });

  it('still lists the levels when your level could not load, without marking one (mock-up E)', async () => {
    mockParams = { ladder: 'distance' };
    mockWeek = { forge: null, loadFailed: true };
    await render(<ForgeLadderScreen />);

    expect(screen.getByText('Level not loaded')).toBeTruthy();
    expect(screen.getByText("Your level couldn't load. Check your connection, then pull down to try again.")).toBeTruthy();
    expect(screen.getAllByText(/^Level \d+$/)).toHaveLength(15);
    expect(screen.queryByText('You')).toBeNull();
  });

  it('shows a dash, not an error, while the week is still loading', async () => {
    mockWeek = { forge: null, loadFailed: false };
    await render(<ForgeLadderScreen />);

    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('Level not loaded')).toBeNull();
  });

  it('goes home for a ladder that does not exist, and back from a real one', async () => {
    mockParams = { ladder: 'swimming' };
    await render(<ForgeLadderScreen />);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');

    mockParams = { ladder: 'volume' };
    await render(<ForgeLadderScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
