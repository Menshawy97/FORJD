// R1 -- the read path + retry surface the audit found entirely missing (C3). A `failed` row in
// the local sync queue used to be invisible: no banner, no retry, no report. This pins Home's
// half of the fix -- see `src/store/__tests__/workout-session.test.ts` for the store's
// `getFailedSessions`/`retryFailedSession` and `src/app/__tests__/live.test.tsx` for the
// Finish-handler half.
//
// NOTE: RTL v14 -- render() and every fireEvent.* return Promises and must be awaited.
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
  listPrograms: jest.fn().mockResolvedValue({ items: [] }),
  getMe: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@example.com', profile: null, privacy: null }),
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

import { getFailedSessions, retryFailedSession, openWorkoutSessionDb, ensureWorkoutSessionSchema } from '@/store/workout-session';
import { syncPendingSessions } from '@/workouts/sync-sessions';

import HomeScreen from '../(tabs)/index';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const FAKE_DB = { marker: 'fake-db' };

const failedRow = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'session-1',
  payload: { id: 'session-1', name: 'Upper Push', activity: 'strength' },
  status: 'failed',
  attemptCount: 5,
  nextRetryAt: '2026-09-02T09:00:00.000Z',
  lastError: 'contract drift',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (openWorkoutSessionDb as jest.Mock).mockResolvedValue(FAKE_DB);
  (ensureWorkoutSessionSchema as jest.Mock).mockResolvedValue(undefined);
  (getFailedSessions as jest.Mock).mockResolvedValue([]);
  (retryFailedSession as jest.Mock).mockResolvedValue(undefined);
  (syncPendingSessions as jest.Mock).mockResolvedValue({ uploaded: [], failed: [] });
});

describe('the failed-sync banner (C3)', () => {
  it('renders nothing when there are no failed sessions', async () => {
    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(getFailedSessions).toHaveBeenCalledWith(FAKE_DB));
    expect(screen.queryByText(/wasn't saved/i)).toBeNull();
  });

  it('names the lost workout and offers a retry control', async () => {
    (getFailedSessions as jest.Mock).mockResolvedValue([failedRow()]);

    const screen = await render(<HomeScreen />);

    expect(await screen.findByText(/Upper Push/)).toBeTruthy();
    expect(screen.getByLabelText(/retry/i)).toBeTruthy();
  });

  it('tapping retry calls retryFailedSession then drains the queue, and clears once it succeeds', async () => {
    (getFailedSessions as jest.Mock)
      .mockResolvedValueOnce([failedRow()])
      .mockResolvedValue([]);

    const screen = await render(<HomeScreen />);
    const retryButton = await screen.findByLabelText(/retry/i);

    await fireEvent.press(retryButton);

    await waitFor(() => expect(retryFailedSession).toHaveBeenCalledWith(FAKE_DB, 'session-1'));
    expect(syncPendingSessions).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/Upper Push/)).toBeNull());
  });
});
