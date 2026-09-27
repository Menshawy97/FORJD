// The Weekly Forge section on Home: it owns the flag, the loading and the stale-answer guards,
// following the bug checklist in docs/product/weekly-forge-plan.md (Phases 9 and 10).
import type { ForgeResponse } from '@forjd/contracts';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AxiosError, type AxiosResponse } from 'axios';

const mockFocusCallbacks: (() => void | (() => void))[] = [];
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusCallbacks.push(callback);
      react.useEffect(() => callback(), [callback]);
    },
  };
});
jest.mock('@/auth/apiClient', () => ({ getForge: jest.fn() }));
jest.mock('@/auth/secureStorage', () => ({ getAccountId: jest.fn() }));
jest.mock('@/features/flags/feature-flags', () => ({ useFeatureFlag: jest.fn() }));

import { getForge } from '@/auth/apiClient';
import { getAccountId } from '@/auth/secureStorage';
import { useFeatureFlag } from '@/features/flags/feature-flags';
import { WeeklyForgeSection } from '../weekly-forge-section';

const fetchForge = getForge as jest.Mock;
const accountId = getAccountId as jest.Mock;
const flag = useFeatureFlag as jest.Mock;

const forge = (daysLeft: number): ForgeResponse => ({
  weekStart: '2026-09-26',
  daysLeft,
  timeZone: 'Africa/Cairo',
  ladders: [
    {
      ladder: 'volume',
      unit: 'kg',
      band: 'ember',
      level: 7,
      maxLevel: 33,
      target: 5600,
      total: 3000,
      progress: 3000 / 5600,
      missStreak: 0,
      forgedStreak: 0,
      bestForgedStreak: 0,
      badges: ['ore', 'ember'],
    },
  ],
});

function notFound(): AxiosError {
  const error = new AxiosError('Not Found');
  error.response = { status: 404, data: {}, statusText: '', headers: {}, config: {} } as AxiosResponse;
  return error;
}

describe('WeeklyForgeSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallbacks.length = 0;
    flag.mockReturnValue(true);
    accountId.mockResolvedValue('user-1');
    fetchForge.mockResolvedValue(forge(3));
  });

  it('renders nothing and asks for nothing while the weekly_forge flag is off', async () => {
    flag.mockReturnValue(false);

    await render(<WeeklyForgeSection />);

    expect(screen.queryByText('Weekly Forge')).toBeNull();
    expect(fetchForge).not.toHaveBeenCalled();
  });

  it('shows the dashes first, then this week', async () => {
    let resolve: (value: ForgeResponse) => void = () => undefined;
    fetchForge.mockReturnValue(new Promise<ForgeResponse>((r) => (resolve = r)));

    await render(<WeeklyForgeSection />);
    expect(screen.getByLabelText('Volume: not loaded yet')).toBeTruthy();

    await act(async () => resolve(forge(3)));
    expect(screen.getByLabelText('Volume, Ember level 7: 3,000 of 5,600 kg')).toBeTruthy();
    expect(screen.getByText('3 days left')).toBeTruthy();
  });

  it('hides itself when the server says the feature is off (404)', async () => {
    fetchForge.mockRejectedValue(notFound());

    await render(<WeeklyForgeSection />);

    await waitFor(() => expect(screen.queryByText('Weekly Forge')).toBeNull());
  });

  it('keeps the last good week when a refresh fails', async () => {
    await render(<WeeklyForgeSection />);
    await waitFor(() => expect(screen.getByText('3 days left')).toBeTruthy());

    fetchForge.mockRejectedValue(new Error('offline'));
    await act(async () => {
      mockFocusCallbacks.at(-1)?.();
    });

    expect(screen.getByText('3 days left')).toBeTruthy();
  });

  it('ignores an answer that arrives after a newer load started', async () => {
    let resolveOld: (value: ForgeResponse) => void = () => undefined;
    fetchForge.mockReturnValueOnce(new Promise<ForgeResponse>((r) => (resolveOld = r)));
    fetchForge.mockResolvedValueOnce(forge(2));

    await render(<WeeklyForgeSection />);
    await act(async () => {
      mockFocusCallbacks.at(-1)?.();
    });
    await waitFor(() => expect(screen.getByText('2 days left')).toBeTruthy());

    await act(async () => resolveOld(forge(5)));
    expect(screen.getByText('2 days left')).toBeTruthy();
    expect(screen.queryByText('5 days left')).toBeNull();
  });

  it('ignores an answer that arrives after a different account signed in', async () => {
    accountId.mockResolvedValueOnce('user-1').mockResolvedValueOnce('user-2');

    await render(<WeeklyForgeSection />);

    await waitFor(() => expect(fetchForge).toHaveBeenCalled());
    expect(screen.queryByText('3 days left')).toBeNull();
    expect(screen.getByLabelText('Volume: not loaded yet')).toBeTruthy();
  });
});
