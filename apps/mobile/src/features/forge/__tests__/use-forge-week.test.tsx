// useForgeWeek's load state for the ladder screen (weekly-forge-explainer-plan.md X3): it has to tell
// "still loading" from "could not load", and let pull-to-refresh ask again.
import type { ForgeResponse } from '@forjd/contracts';
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
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
import { useForgeWeek } from '../use-forge-week';

const fetchForge = getForge as jest.Mock;

const WEEK: ForgeResponse = { weekStart: '2026-09-26', daysLeft: 6, timeZone: 'Africa/Cairo', ladders: [] };

beforeEach(() => {
  jest.clearAllMocks();
  (useFeatureFlag as jest.Mock).mockReturnValue(true);
  (getAccountId as jest.Mock).mockResolvedValue('account-1');
});

describe('useForgeWeek', () => {
  it('is neither loaded nor failed while the first read is in flight', async () => {
    fetchForge.mockReturnValue(new Promise(() => undefined));
    const { result } = await renderHook(() => useForgeWeek());

    expect(result.current.forge).toBeNull();
    expect(result.current.loadFailed).toBe(false);
  });

  it('reports a failed first read, then clears it when a reload succeeds', async () => {
    fetchForge.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(WEEK);
    const { result } = await renderHook(() => useForgeWeek());
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.loadFailed).toBe(false);
    expect(result.current.forge).toEqual(WEEK);
  });

  it('keeps the last good week, and does not report a failure, when a later read fails', async () => {
    fetchForge.mockResolvedValueOnce(WEEK).mockRejectedValueOnce(new Error('offline'));
    const { result } = await renderHook(() => useForgeWeek());
    await waitFor(() => expect(result.current.forge).toEqual(WEEK));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.forge).toEqual(WEEK);
    expect(result.current.loadFailed).toBe(false);
  });
});
