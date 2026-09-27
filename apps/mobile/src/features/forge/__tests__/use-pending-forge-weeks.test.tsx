// The closed weeks waiting to be celebrated on Home, oldest first, and their acknowledgement.
// Follows the bug checklist in docs/product/weekly-forge-plan.md: flag-gated, stale and
// other-account answers dropped, a double tap acknowledges once, nothing fails silently.
import type { ForgeWeekSummary } from '@forjd/contracts';
import { act, renderHook, waitFor } from '@testing-library/react-native';

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
jest.mock('@/auth/apiClient', () => ({ getPendingForgeWeeks: jest.fn(), ackForgeWeek: jest.fn() }));
jest.mock('@/auth/secureStorage', () => ({ getAccountId: jest.fn() }));
jest.mock('@/features/flags/feature-flags', () => ({ useFeatureFlag: jest.fn() }));

import { ackForgeWeek, getPendingForgeWeeks } from '@/auth/apiClient';
import { getAccountId } from '@/auth/secureStorage';
import { useFeatureFlag } from '@/features/flags/feature-flags';
import { usePendingForgeWeeks } from '../use-pending-forge-weeks';

const fetchPending = getPendingForgeWeeks as jest.Mock;
const ack = ackForgeWeek as jest.Mock;
const accountId = getAccountId as jest.Mock;
const flag = useFeatureFlag as jest.Mock;

const week = (weekStart: string): ForgeWeekSummary => ({
  weekStart,
  biggest: 'none',
  biggestLadder: null,
  shareable: false,
  levelsGained: 0,
  marksEarned: 0,
  ladders: [],
});

const refocus = async () => {
  await act(async () => {
    mockFocusCallbacks.at(-1)?.();
  });
};

describe('usePendingForgeWeeks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallbacks.length = 0;
    flag.mockReturnValue(true);
    accountId.mockResolvedValue('user-1');
    fetchPending.mockResolvedValue({ weeks: [week('2026-09-12'), week('2026-09-19')] });
    ack.mockResolvedValue(undefined);
  });

  it('asks for nothing while the weekly_forge flag is off', async () => {
    flag.mockReturnValue(false);

    const { result } = await renderHook(() => usePendingForgeWeeks());

    expect(fetchPending).not.toHaveBeenCalled();
    expect(result.current.current).toBeNull();
  });

  it('offers the oldest unseen week first', async () => {
    const { result } = await renderHook(() => usePendingForgeWeeks());

    await waitFor(() => expect(result.current.current?.weekStart).toBe('2026-09-12'));
  });

  it('acknowledges once however often Done is pressed, then moves to the next week', async () => {
    const { result } = await renderHook(() => usePendingForgeWeeks());
    await waitFor(() => expect(result.current.current).not.toBeNull());

    await act(async () => {
      void result.current.acknowledge('2026-09-12');
      void result.current.acknowledge('2026-09-12');
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith('2026-09-12');
    expect(result.current.current?.weekStart).toBe('2026-09-19');
  });

  it('closes a week whose acknowledgement failed for the rest of this run, without an unhandled error', async () => {
    ack.mockRejectedValueOnce(new Error('offline'));
    const { result } = await renderHook(() => usePendingForgeWeeks());
    await waitFor(() => expect(result.current.current).not.toBeNull());

    await act(async () => {
      await result.current.acknowledge('2026-09-12');
    });
    expect(result.current.current?.weekStart).toBe('2026-09-19');

    await act(async () => {
      await result.current.acknowledge('2026-09-19');
    });
    await refocus();
    // The server still lists the failed week, but this run does not show it again.
    await waitFor(() => expect(fetchPending).toHaveBeenCalledTimes(2));
    expect(result.current.current?.weekStart).toBe('2026-09-19');
  });

  it('does not ask again while a week is still on screen', async () => {
    const { result } = await renderHook(() => usePendingForgeWeeks());
    await waitFor(() => expect(result.current.current).not.toBeNull());

    await refocus();

    expect(fetchPending).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when the server cannot be reached', async () => {
    fetchPending.mockRejectedValue(new Error('offline'));

    const { result } = await renderHook(() => usePendingForgeWeeks());

    await waitFor(() => expect(fetchPending).toHaveBeenCalled());
    expect(result.current.current).toBeNull();
  });

  it('drops an answer that arrives after a different account signed in', async () => {
    accountId.mockResolvedValueOnce('user-1').mockResolvedValueOnce('user-2');

    const { result } = await renderHook(() => usePendingForgeWeeks());

    await waitFor(() => expect(fetchPending).toHaveBeenCalled());
    expect(result.current.current).toBeNull();
  });
});
