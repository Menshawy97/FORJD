// ADR-048. Home already asks the server who the signed-in person is every time it loads. That answer
// also says whether they allowed location for leaderboards, so Home keeps the device's copy of it
// true. A workout then decides locally, with no network, whether to read a position: it never has
// to ask the server itself (which could, in a rare refresh failure, sign the person out mid-set).
//
// NOTE: RTL v14 -- render() returns a Promise and must be awaited.
import { render as rtlRender, waitFor } from '@testing-library/react-native';
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
  listPrograms: jest.fn().mockResolvedValue({ items: [] }),
  getMe: jest.fn(),
  listNutritionLog: jest.fn().mockResolvedValue({ items: [] }),
  getMacroGoals: jest.fn().mockRejectedValue(new Error('no goals')),
  getWorkoutStats: jest.fn().mockRejectedValue(new Error('no stats')),
  getHealthObservationSeries: jest.fn().mockRejectedValue(new Error('no health data in this suite')),
  getReadiness: jest.fn().mockRejectedValue(new Error('no readiness in this suite')),
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

jest.mock('@/store/leaderboard-consent', () => ({
  rememberLocationConsent: jest.fn().mockResolvedValue(undefined),
}));

import { getMe } from '@/auth/apiClient';
import { rememberLocationConsent } from '@/store/leaderboard-consent';
import { ensureWorkoutSessionSchema, getFailedSessions, openWorkoutSessionDb } from '@/store/workout-session';
import { syncPendingSessions } from '@/workouts/sync-sessions';

import HomeScreen from '../(tabs)/index';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const meWith = (privacy: Record<string, unknown> | null) => ({
  id: 'u1',
  email: 'a@example.com',
  profile: null,
  privacy,
});

describe('Home keeps the on-device location consent true', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (openWorkoutSessionDb as jest.Mock).mockResolvedValue({});
    (ensureWorkoutSessionSchema as jest.Mock).mockResolvedValue(undefined);
    (getFailedSessions as jest.Mock).mockResolvedValue([]);
    (syncPendingSessions as jest.Mock).mockResolvedValue({ uploaded: [], failed: [] });
  });

  it('records a yes the server reports', async () => {
    (getMe as jest.Mock).mockResolvedValue(meWith({ locationForLeaderboard: true }));

    await render(<HomeScreen />);

    await waitFor(() => expect(rememberLocationConsent).toHaveBeenCalledWith(true));
  });

  it('records a no, so a workout stops reading a position once it has been withdrawn elsewhere', async () => {
    (getMe as jest.Mock).mockResolvedValue(meWith({ locationForLeaderboard: false }));

    await render(<HomeScreen />);

    await waitFor(() => expect(rememberLocationConsent).toHaveBeenCalledWith(false));
  });

  it('records nothing when the account has no privacy settings yet', async () => {
    (getMe as jest.Mock).mockResolvedValue(meWith(null));

    await render(<HomeScreen />);
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rememberLocationConsent).not.toHaveBeenCalled();
  });

  it('records nothing when the server cannot be reached, because nothing is known', async () => {
    (getMe as jest.Mock).mockRejectedValue(new Error('offline'));

    await render(<HomeScreen />);
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rememberLocationConsent).not.toHaveBeenCalled();
  });
});
