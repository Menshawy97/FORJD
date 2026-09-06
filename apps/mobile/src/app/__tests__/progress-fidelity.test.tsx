// The Progress tab's Strength view (Phase 4), built against `progress strength.png`,
// `progress strength 2.png` and `progress strength 3.png`.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    const react = require('react');
    react.useEffect(() => {
      callback();
    }, []);
  },
}));

jest.mock('@/auth/apiClient', () => ({
  getProgressStrength: jest.fn(),
}));

import { getProgressStrength } from '@/auth/apiClient';

import ProgressScreen from '../(tabs)/progress';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const EMPTY_RESPONSE = {
  personalRecords: [],
  oneRepMaxTrend: [],
  weeklyVolumeKg: Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, volumeKg: 0 })),
  trainingCalendar: { month: '2026-08', days: [], daysTrained: 0 },
  muscleSplit: [],
  insight: null,
};

const FULL_RESPONSE = {
  personalRecords: [
    {
      exerciseId: '11111111-1111-4111-8111-111111111111',
      exerciseName: 'Back Squat',
      weightKg: 140,
      reps: 1,
      achievedAt: '2026-08-19T09:00:00.000Z',
      deltaKgSinceLastMonth: 7.5,
    },
    {
      exerciseId: '22222222-2222-4222-8222-222222222222',
      exerciseName: 'Bench Press',
      weightKg: 100,
      reps: 1,
      achievedAt: '2026-08-12T09:00:00.000Z',
      deltaKgSinceLastMonth: 5,
    },
  ],
  oneRepMaxTrend: [
    { weekStart: '2026-07-06', estimatedOneRepMaxKg: 88 },
    { weekStart: '2026-08-24', estimatedOneRepMaxKg: 100 },
  ],
  weeklyVolumeKg: [
    { dayOfWeek: 1, volumeKg: 8200 },
    { dayOfWeek: 2, volumeKg: 5400 },
    { dayOfWeek: 3, volumeKg: 0 },
    { dayOfWeek: 4, volumeKg: 0 },
    { dayOfWeek: 5, volumeKg: 11200 },
    { dayOfWeek: 6, volumeKg: 4500 },
    { dayOfWeek: 7, volumeKg: 0 },
  ],
  trainingCalendar: {
    month: '2026-08',
    days: [
      { date: '2026-08-03', activity: 'strength' as const },
      { date: '2026-08-06', activity: 'run' as const },
    ],
    daysTrained: 13,
  },
  muscleSplit: [
    { bucket: 'legs' as const, percent: 28 },
    { bucket: 'back' as const, percent: 22 },
  ],
  insight: {
    headline: 'Training volume up 14% this week.',
    body: 'Total load moved with it.',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Progress screen chrome', () => {
  it('renders the title and the Strength/Body/Health segmented control', async () => {
    (getProgressStrength as jest.Mock).mockResolvedValue(EMPTY_RESPONSE);
    const screen = await render(<ProgressScreen />);

    expect(screen.getByText('Progress')).toBeTruthy();
    // "Strength" also appears in the training calendar's own legend, so at least one match --
    // not exactly one -- is what proves the tab renders.
    expect(screen.getAllByText('Strength').length).toBeGreaterThan(0);
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByText('Health')).toBeTruthy();
  });

  it('switches to the Body tab and shows an honest-empty explanation, not the Strength cards', async () => {
    (getProgressStrength as jest.Mock).mockResolvedValue(EMPTY_RESPONSE);
    const screen = await render(<ProgressScreen />);
    await waitFor(() => expect(getProgressStrength).toHaveBeenCalled());

    fireEvent.press(screen.getByText('Body'));

    await waitFor(() => expect(screen.getByText(/InBody/)).toBeTruthy());
    expect(screen.queryByText('Muscle group split')).toBeNull();
  });
});

describe('Strength view, empty account', () => {
  it('renders honest-empty PR tiles, calendar and insight rather than the design demo numbers', async () => {
    (getProgressStrength as jest.Mock).mockResolvedValue(EMPTY_RESPONSE);
    const screen = await render(<ProgressScreen />);

    await waitFor(() => expect(getProgressStrength).toHaveBeenCalled());

    expect(screen.queryByText('Bench PR')).toBeNull();
    expect(screen.queryByText('100')).toBeNull();
    expect(screen.getByText('FORJD Insight')).toBeTruthy();
    expect(
      screen.getByText(/Keep logging sessions and this card will start reporting/),
    ).toBeTruthy();
  });

  // Regression test: the PR row and the muscle-split card used to vanish entirely for an
  // account with no data, rather than showing their chrome honestly empty like every other
  // card in this app -- found on a physical device, not by these tests, which is why this
  // case is pinned explicitly now.
  it('still shows the PR tile row and the muscle-split card chrome when there is no data', async () => {
    (getProgressStrength as jest.Mock).mockResolvedValue(EMPTY_RESPONSE);
    const screen = await render(<ProgressScreen />);

    await waitFor(() => expect(getProgressStrength).toHaveBeenCalled());

    expect(screen.getAllByText('PR')).toHaveLength(2);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Muscle group split')).toBeTruthy();
    expect(
      screen.getByText(/Log a weighted set this month to see which muscle groups/),
    ).toBeTruthy();
  });
});

describe('Strength view, populated account', () => {
  it('renders both PR tiles headed by their own exercise name', async () => {
    (getProgressStrength as jest.Mock).mockResolvedValue(FULL_RESPONSE);
    const screen = await render(<ProgressScreen />);

    await waitFor(() => expect(screen.getByText('Back Squat PR')).toBeTruthy());
    expect(screen.getByText('Bench Press PR')).toBeTruthy();
    expect(screen.getByText('140')).toBeTruthy();
  });

  it('renders the real insight headline rather than the honest-empty copy', async () => {
    (getProgressStrength as jest.Mock).mockResolvedValue(FULL_RESPONSE);
    const screen = await render(<ProgressScreen />);

    await waitFor(() => expect(screen.getByText(/Training volume up 14%/)).toBeTruthy());
  });

  it('renders the training calendar day count', async () => {
    (getProgressStrength as jest.Mock).mockResolvedValue(FULL_RESPONSE);
    const screen = await render(<ProgressScreen />);

    await waitFor(() => expect(screen.getByText('13 days trained')).toBeTruthy());
  });
});
