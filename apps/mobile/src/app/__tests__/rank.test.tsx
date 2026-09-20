// Phase 10K. The Rank tab against `screenshots/leaderboard.png` and the prototype's `isRank`
// markup. Every figure on it must come from the server response, so these tests feed real
// contract-shaped responses and assert on what is drawn, including the values that used to be
// hard-coded literals in the prototype (`Alexandria`, `#47`, `92.7`, `Top 8%`, `Aug 2026`).
//
// NOTE: @testing-library/react-native v14 -- render() and every fireEvent.* return Promises
// and must be awaited.
import type { LeaderboardResponse } from '@forjd/contracts';
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    // Re-runs when the callback changes, as the real one does when its dependencies change.
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({ getLeaderboard: jest.fn() }));

import { getLeaderboard } from '@/auth/apiClient';

import RankScreen from '../(tabs)/rank';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const mockGet = getLeaderboard as jest.MockedFunction<typeof getLeaderboard>;

const row = (over: Partial<LeaderboardResponse['rows'][number]> & { rank: number }) => ({
  userId: `user-${over.rank}`,
  displayName: `Athlete ${over.rank}`,
  username: `ath${over.rank}`,
  avatarUrl: null,
  score: 90 - over.rank / 10,
  delta: null,
  isSelf: false,
  isPublicProfile: true,
  ...over,
});

const RANKED: LeaderboardResponse = {
  status: 'ranked',
  metric: 'activity',
  period: 'month',
  city: { name: 'Cairo', slug: 'cairo-eg-360630' },
  periodLabel: 'Sep 2026',
  cohortSize: 60,
  minCohortSize: 5,
  me: { rank: 47, score: 92.7, topPercent: 8, delta: 3 },
  rows: [
    row({ rank: 45, score: 93.8, delta: 1 }),
    row({ rank: 46, score: 93.1, delta: 0, isPublicProfile: false, displayName: 'Daniel H.' }),
    row({ rank: 47, score: 92.7, delta: 3, isSelf: true, userId: 'me', displayName: 'James M.' }),
    row({ rank: 48, score: 92.3, delta: -1, displayName: 'Lena K.' }),
    row({ rank: 49, score: 91.9, delta: null, displayName: 'Marcus T.' }),
  ],
};

const emptyState = (
  status: LeaderboardResponse['status'],
  over: Partial<LeaderboardResponse> = {},
): LeaderboardResponse =>
  ({
    status,
    metric: 'activity',
    period: 'month',
    city: null,
    periodLabel: 'Sep 2026',
    cohortSize: 0,
    minCohortSize: 5,
    me: null,
    rows: [],
    ...over,
  }) as LeaderboardResponse;

describe('RankScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(RANKED);
  });

  describe('a ranked board', () => {
    it("draws the city, the caller's rank card and every figure from the response", async () => {
      const { findByText, getByText } = await render(<RankScreen />);

      expect(await findByText('Cairo')).toBeTruthy();
      expect(getByText('#47')).toBeTruthy();
      expect(getByText('↑ 3 this week')).toBeTruthy();
      expect(getByText('Top 8%')).toBeTruthy();
      expect(getByText('Your rank')).toBeTruthy();
    });

    it('titles the list with the metric and the window text the server sent', async () => {
      const { findByText } = await render(<RankScreen />);

      expect(await findByText('Activity score — Sep 2026')).toBeTruthy();
    });

    it('draws every row with rank, name and one-decimal score, and marks the caller', async () => {
      const { findByText, getByText } = await render(<RankScreen />);

      await findByText('Cairo');
      expect(getByText('Athlete 45')).toBeTruthy();
      expect(getByText('93.8')).toBeTruthy();
      expect(getByText('James M. (you)')).toBeTruthy();
      expect(getByText('Lena K.')).toBeTruthy();
    });

    it("shows each athlete's @username under the name, and nothing for one with no username", async () => {
      mockGet.mockResolvedValue({
        ...RANKED,
        rows: [...RANKED.rows.slice(0, 4), { ...RANKED.rows[4]!, username: null }],
      });
      const { findByText, getByText, queryByText } = await render(<RankScreen />);

      await findByText('Cairo');
      expect(getByText('@ath45')).toBeTruthy();
      expect(getByText('@ath47')).toBeTruthy();
      expect(queryByText('@null')).toBeNull();
      expect(queryByText('@')).toBeNull();
    });

    it('draws the movement arrows: up, down and flat, and nothing where there is no baseline', async () => {
      const { findByText, getByText, queryByText } = await render(<RankScreen />);

      await findByText('Cairo');
      expect(getByText('↑1')).toBeTruthy();
      expect(getByText('—')).toBeTruthy();
      expect(getByText('↑3')).toBeTruthy();
      expect(getByText('↓1')).toBeTruthy();
      // Marcus has no baseline: no dash that would read as "no change".
      expect(queryByText('↓0')).toBeNull();
    });

    it('omits the week line when there is no movement figure yet', async () => {
      mockGet.mockResolvedValue({ ...RANKED, me: { rank: 47, score: 92.7, topPercent: 8, delta: null } });
      const { findByText, queryByText } = await render(<RankScreen />);

      await findByText('#47');
      expect(queryByText(/this week/)).toBeNull();
    });

    it('says "No change this week" for a flat week', async () => {
      mockGet.mockResolvedValue({ ...RANKED, me: { rank: 47, score: 92.7, topPercent: 8, delta: 0 } });
      const { findByText } = await render(<RankScreen />);

      expect(await findByText('No change this week')).toBeTruthy();
    });
  });

  describe('taps', () => {
    it('opens another athlete with a public profile, telling the athlete screen to come back here', async () => {
      const { findByLabelText } = await render(<RankScreen />);

      await fireEvent.press(await findByLabelText('Rank 48, Lena K., @ath48, score 92.3'));

      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/athlete/[userId]',
        params: { userId: 'user-48', from: 'rank' },
      });
    });

    it("sends the caller's own row to their profile", async () => {
      const { findByLabelText } = await render(<RankScreen />);

      await fireEvent.press(await findByLabelText('Rank 47, James M. (you), @ath47, score 92.7'));

      expect(mockPush).toHaveBeenCalledWith('/profile');
    });

    it('does not make a private profile a button, but still shows the name', async () => {
      const { findByText, queryByLabelText } = await render(<RankScreen />);

      expect(await findByText('Daniel H.')).toBeTruthy();
      expect(queryByLabelText(/Daniel H\./)).toBeNull();
    });

    it('opens Location from the pin', async () => {
      const { findByLabelText } = await render(<RankScreen />);

      await fireEvent.press(await findByLabelText('Location settings'));

      expect(mockPush).toHaveBeenCalledWith('/location');
    });
  });

  describe('the chips and the period control', () => {
    it('asks for Activity, this month, first', async () => {
      await render(<RankScreen />);

      await waitFor(() => expect(mockGet).toHaveBeenCalledWith({ metric: 'activity', period: 'month' }));
    });

    it('asks again for the chosen metric', async () => {
      const { findByText } = await render(<RankScreen />);
      await findByText('Cairo');

      await fireEvent.press(await findByText('Strength'));

      await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith({ metric: 'strength', period: 'month' }));
    });

    it('asks again for all time', async () => {
      const { findByText } = await render(<RankScreen />);
      await findByText('Cairo');

      await fireEvent.press(await findByText('All Time'));

      await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith({ metric: 'activity', period: 'all_time' }));
    });

    it('marks the chosen chip as selected', async () => {
      const { findByText, findByRole } = await render(<RankScreen />);
      await findByText('Cairo');

      await fireEvent.press(await findByText('Running'));

      expect((await findByRole('button', { name: 'Running' })).props.accessibilityState).toMatchObject({
        selected: true,
      });
    });
  });

  describe('the states without a list', () => {
    it('says a metric with no score yet is coming soon, with no rank card', async () => {
      mockGet.mockResolvedValue(
        emptyState('coming_soon', { metric: 'strength', city: { name: 'Cairo', slug: 'c' } }),
      );
      const { findByText, queryByText } = await render(<RankScreen />);

      expect(await findByText('Strength rankings are coming soon')).toBeTruthy();
      expect(queryByText('Your rank')).toBeNull();
    });

    it('invites an athlete who has not joined, and the button goes to Location', async () => {
      mockGet.mockResolvedValue(emptyState('not_opted_in'));
      const { findByText, findByRole } = await render(<RankScreen />);

      expect(await findByText('Join your city’s leaderboard')).toBeTruthy();
      await fireEvent.press(await findByRole('button', { name: 'Set up' }));
      expect(mockPush).toHaveBeenCalledWith('/location');
    });

    it('asks for location when the athlete has joined but no city is known', async () => {
      mockGet.mockResolvedValue(emptyState('no_city'));
      const { findByText } = await render(<RankScreen />);

      expect(await findByText('Allow location to find your city')).toBeTruthy();
    });

    it('explains that only workouts run with the timer count, with no button to press', async () => {
      mockGet.mockResolvedValue(emptyState('no_eligible_sessions'));
      const { findByText, queryByRole } = await render(<RankScreen />);

      expect(await findByText('Nothing to rank yet')).toBeTruthy();
      expect(queryByRole('button', { name: 'Set up' })).toBeNull();
    });

    it('shows the true head-count against the minimum for a city that is too small', async () => {
      mockGet.mockResolvedValue(
        emptyState('cohort_too_small', { city: { name: 'Oslo', slug: 'oslo-no-1' }, cohortSize: 3 }),
      );
      const { findByText } = await render(<RankScreen />);

      expect(await findByText('Oslo is getting started')).toBeTruthy();
      expect(await findByText('3 of the 5 athletes needed to show a leaderboard have joined so far.')).toBeTruthy();
    });

    it('names the city in the heading for a state that has one', async () => {
      mockGet.mockResolvedValue(
        emptyState('cohort_too_small', { city: { name: 'Oslo', slug: 'oslo-no-1' }, cohortSize: 3 }),
      );
      const { findByText } = await render(<RankScreen />);

      expect(await findByText('Oslo')).toBeTruthy();
    });

    it('falls back to a neutral heading when there is no city', async () => {
      mockGet.mockResolvedValue(emptyState('not_opted_in'));
      const { findByText } = await render(<RankScreen />);

      expect(await findByText('Your city')).toBeTruthy();
    });
  });

  describe('a failed request', () => {
    it('shows a retry, and the retry asks again', async () => {
      mockGet.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(RANKED);
      const { findByText, findByRole } = await render(<RankScreen />);

      expect(await findByText('Could not load the leaderboard')).toBeTruthy();
      await fireEvent.press(await findByRole('button', { name: 'Try again' }));

      expect(await findByText('Cairo')).toBeTruthy();
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('still draws the chips so the athlete can move on', async () => {
      mockGet.mockRejectedValue(new Error('network'));
      const { findByText } = await render(<RankScreen />);

      await findByText('Could not load the leaderboard');
      expect(await findByText('Activity')).toBeTruthy();
      expect(await findByText('This Month')).toBeTruthy();
    });
  });
});
