// RED first, Phase 3J-c -- Home's stat strip, "This week" and "Recent PR", once there is
// something real to put in them.
//
// Phase 2 shipped all three as honest empty states because nothing could count a workout.
// `home-fidelity.test.tsx` still pins those empty states, deliberately: they are what a new
// account sees, and what a failed request falls back to. This file pins the other half.
//
// NOTE: RTL v14 -- render() and every fireEvent.* return Promises and must be awaited.
import { AxiosError } from 'axios';
import { render as rtlRender } from '@testing-library/react-native';
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
  // Phase 3K5: Home's Start Workout and Train's programs sections both read this.
  getProgramEnrollment: jest.fn().mockResolvedValue({ enrollment: null }),
  listPrograms: jest.fn().mockResolvedValue({ items: [] }),
  getMe: jest.fn(),
  listNutritionLog: jest.fn(),
  getMacroGoals: jest.fn(),
  getWorkoutStats: jest.fn(),
  // Phase 6: Home also reads health-observation series and readiness -- not under test here,
  // rejected so the loaded stats remain the only signal these assertions depend on.
  getHealthObservationSeries: jest.fn().mockRejectedValue(new Error('no health data in this suite')),
  getReadiness: jest.fn().mockRejectedValue(new Error('no readiness in this suite')),
  // Home's City Rank tile reads the Activity board; not under test in this suite.
  getLeaderboard: jest.fn().mockRejectedValue(new Error('no leaderboard in this suite')),
}));

import type { LeaderboardResponse } from '@forjd/contracts';

import { getLeaderboard, getMacroGoals, getMe, getWorkoutStats, listNutritionLog } from '@/auth/apiClient';

import HomeScreen from '../(tabs)/index';

/** A board with the caller ranked at `rank`, or an empty-state board for any other status. */
function board(status: LeaderboardResponse['status'], rank = 47): LeaderboardResponse {
  const ranked = status === 'ranked';
  return {
    status,
    metric: 'activity',
    period: 'month',
    city: ranked || status === 'cohort_too_small' ? { name: 'Cairo', slug: 'cairo-eg-360630' } : null,
    periodLabel: 'Sep 2026',
    cohortSize: ranked ? 60 : status === 'cohort_too_small' ? 3 : 0,
    minCohortSize: 5,
    me: ranked ? { rank, score: 92.7, topPercent: 8, delta: 3 } : null,
    rows: [],
  } as LeaderboardResponse;
}

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const stats = (overrides: Record<string, unknown> = {}) => ({
  totalSessions: 42,
  sessionsThisMonth: 6,
  weekStreak: 3,
  // Monday and Wednesday, indexed like Date#getDay().
  thisWeek: { sessionCount: 2, trainedWeekdays: [1, 3] },
  recentPersonalRecord: {
    exerciseId: '33333333-3333-4333-8333-333333333333',
    exerciseName: 'Bench Press',
    weightKg: 100,
    reps: 5,
    achievedAt: '2026-09-01T09:05:00.000Z',
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (getMe as jest.Mock).mockResolvedValue({
    id: 'u1',
    email: 'a@example.com',
    profile: null,
    privacy: null,
  });
  (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
  (getMacroGoals as jest.Mock).mockRejectedValue(new AxiosError('no goals'));
  (getWorkoutStats as jest.Mock).mockResolvedValue(stats());
});

describe('the stat strip counters', () => {
  it('shows the real counts, which nothing in the app could produce before', async () => {
    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('42')).toBeTruthy();
    expect(await screen.findByText('6')).toBeTruthy();
    expect(await screen.findByText('3')).toBeTruthy();
  });

  // Phase 10 close-out: City Rank reads the caller's own rank on the Activity board, the same
  // request and period the Rank tab opens on.
  it("shows the caller's city rank from this month's Activity board", async () => {
    (getLeaderboard as jest.Mock).mockResolvedValue(board('ranked', 47));

    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('#47')).toBeTruthy();
    expect(getLeaderboard).toHaveBeenCalledWith({ metric: 'activity', period: 'month' });
  });

  // Anything but a ranked board is "unknown", never "#0": not joined, no city, no eligible
  // session, or a city below five athletes.
  it.each(['not_opted_in', 'no_city', 'no_eligible_sessions', 'cohort_too_small'] as const)(
    'leaves City Rank as a dash when the board says %s',
    async (status) => {
      (getLeaderboard as jest.Mock).mockResolvedValue(board(status));

      const screen = await render(<HomeScreen />);

      await screen.findByText('42');
      expect(screen.getByText('City Rank')).toBeTruthy();
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
      expect(screen.queryByText(/^#\d+$/)).toBeNull();
    },
  );

  it('leaves City Rank as a dash when the leaderboard cannot be reached', async () => {
    (getLeaderboard as jest.Mock).mockRejectedValue(new Error('offline'));

    const screen = await render(<HomeScreen />);

    await screen.findByText('42');
    expect(screen.queryByText(/^#\d+$/)).toBeNull();
  });

  it('still reads zero for an account that has never trained', async () => {
    (getWorkoutStats as jest.Mock).mockResolvedValue(
      stats({
        totalSessions: 0,
        sessionsThisMonth: 0,
        weekStreak: 0,
        thisWeek: { sessionCount: 0, trainedWeekdays: [] },
        recentPersonalRecord: null,
      }),
    );

    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('Workouts')).toBeTruthy();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(3);
  });

  // Home is the launch screen. A failed stats request must leave it looking like a new
  // account, not like a broken screen.
  it('falls back to the honest empty state when the request fails', async () => {
    (getWorkoutStats as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('Workouts')).toBeTruthy();
    expect(screen.getByText('No PR yet')).toBeTruthy();
    expect(screen.getByText('0 sessions')).toBeTruthy();
  });
});

describe('This week', () => {
  it('counts the week and lights only the days that were trained', async () => {
    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('2 sessions')).toBeTruthy();
    // Monday and Wednesday trained; the other five still read as untrained.
    expect(screen.getByLabelText('Session on Monday')).toBeTruthy();
    expect(screen.getByLabelText('Session on Wednesday')).toBeTruthy();
    expect(screen.getAllByLabelText(/^No session on /)).toHaveLength(5);
  });

  it('says "1 session", not "1 sessions"', async () => {
    (getWorkoutStats as jest.Mock).mockResolvedValue(
      stats({ thisWeek: { sessionCount: 1, trainedWeekdays: [2] } }),
    );

    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('1 session')).toBeTruthy();
  });
});

describe('Recent PR', () => {
  it('names the lift, its load and when it was set', async () => {
    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('100 kg × 5')).toBeTruthy();
  });

  // The empty state stays exactly as Phase 2 shipped it -- it is what a new account sees.
  it('keeps the honest empty state when there is no record', async () => {
    (getWorkoutStats as jest.Mock).mockResolvedValue(stats({ recentPersonalRecord: null }));

    const screen = await render(<HomeScreen />);

    expect(await screen.findByText('No PR yet')).toBeTruthy();
    expect(screen.getByText('Finish a workout to set one')).toBeTruthy();
  });
});
