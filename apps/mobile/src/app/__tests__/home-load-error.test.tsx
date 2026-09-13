// R26 -- when every request in Home's load batch fails (no network reachable at all), the
// screen used to fall back to six honestly-empty sections indistinguishable from a brand-new
// account, with no way to know anything had gone wrong and no way to retry. This pins the
// fix: a total failure renders a distinct error banner with a retry control that re-issues the
// whole batch. A *partial* failure (some requests succeed) must still fall back to the
// per-section honest-empty state -- see `home-failed-sync.test.tsx`, which already covers a
// mix of resolved/rejected calls and expects no error text.
//
// NOTE: @testing-library/react-native v14 -- render() and every fireEvent.* return Promises
// and must be awaited.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  getProgramEnrollment: jest.fn().mockResolvedValue({ enrollment: null }),
  getMe: jest.fn(),
  listNutritionLog: jest.fn(),
  getMacroGoals: jest.fn(),
  getWorkoutStats: jest.fn(),
  getHealthObservationSeries: jest.fn(),
  getReadiness: jest.fn(),
}));

jest.mock('@/store/workout-session', () => ({
  openWorkoutSessionDb: jest.fn(),
  ensureWorkoutSessionSchema: jest.fn(),
  getFailedSessions: jest.fn(),
  retryFailedSession: jest.fn(),
}));

jest.mock('@/workouts/sync-sessions', () => ({
  syncPendingSessions: jest.fn(),
}));

import {
  getHealthObservationSeries,
  getMacroGoals,
  getMe,
  getReadiness,
  getWorkoutStats,
  listNutritionLog,
} from '@/auth/apiClient';
import { openWorkoutSessionDb, ensureWorkoutSessionSchema, getFailedSessions } from '@/store/workout-session';

import HomeScreen from '../(tabs)/index';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const mockGetMe = getMe as jest.MockedFunction<typeof getMe>;
const mockListLog = listNutritionLog as jest.MockedFunction<typeof listNutritionLog>;
const mockGoals = getMacroGoals as jest.MockedFunction<typeof getMacroGoals>;
const mockStats = getWorkoutStats as jest.MockedFunction<typeof getWorkoutStats>;
const mockHealth = getHealthObservationSeries as jest.MockedFunction<typeof getHealthObservationSeries>;
const mockReadiness = getReadiness as jest.MockedFunction<typeof getReadiness>;

function rejectEverything() {
  mockGetMe.mockRejectedValue(new Error('boom'));
  mockListLog.mockRejectedValue(new Error('boom'));
  mockGoals.mockRejectedValue(new Error('boom'));
  mockStats.mockRejectedValue(new Error('boom'));
  mockHealth.mockRejectedValue(new Error('boom'));
  mockReadiness.mockRejectedValue(new Error('boom'));
}

beforeEach(() => {
  jest.clearAllMocks();
  (openWorkoutSessionDb as jest.Mock).mockResolvedValue({ marker: 'fake-db' });
  (ensureWorkoutSessionSchema as jest.Mock).mockResolvedValue(undefined);
  (getFailedSessions as jest.Mock).mockResolvedValue([]);
});

describe('Home total-load-failure state (R26)', () => {
  it('renders a distinct error banner, not six empty sections, when every request fails', async () => {
    rejectEverything();

    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('Could not load your dashboard. Please try again.')).toBeTruthy();
    expect(screen.getByLabelText('Retry')).toBeTruthy();
  });

  it('tapping retry re-issues the whole batch', async () => {
    rejectEverything();

    const screen = await render(<HomeScreen />);
    const retryButton = await screen.findByLabelText('Retry');

    expect(mockGetMe).toHaveBeenCalledTimes(1);

    mockGetMe.mockResolvedValue({ id: 'u1', email: 'a@example.com', profile: null, privacy: null });
    mockListLog.mockResolvedValue({ items: [] });

    await fireEvent.press(retryButton);

    await waitFor(() => expect(mockGetMe).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('Could not load your dashboard. Please try again.')).toBeNull(),
    );
  });
});
