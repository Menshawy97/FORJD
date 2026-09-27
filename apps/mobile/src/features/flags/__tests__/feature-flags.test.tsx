// The app's view of the server's feature flags (`GET /feature-flags`), so a dark feature such as
// Weekly Forge (ADR-057) stays invisible until it is switched on. Fetched once per launch, cached
// under a forjd.* key so a relaunch without a network still knows the last answer, and never
// throws: a flag that cannot be read is simply off.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('@/auth/apiClient', () => ({ getFeatureFlags: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, waitFor } from '@testing-library/react-native';

import { getFeatureFlags } from '@/auth/apiClient';
import {
  FEATURE_FLAGS_STORAGE_KEY,
  loadFeatureFlags,
  resetFeatureFlagsForTests,
  useFeatureFlag,
} from '../feature-flags';

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const fetchFlags = getFeatureFlags as jest.Mock;

describe('feature flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetFeatureFlagsForTests();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
    fetchFlags.mockResolvedValue({ enabled: ['weekly_forge'] });
  });

  it('caches under a forjd.* key, so deleting the account wipes it with the rest', () => {
    expect(FEATURE_FLAGS_STORAGE_KEY.startsWith('forjd.')).toBe(true);
  });

  it('asks the server once per launch, however many callers ask', async () => {
    await Promise.all([loadFeatureFlags(), loadFeatureFlags()]);
    await loadFeatureFlags();

    expect(fetchFlags).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(['weekly_forge']));
  });

  it('falls back to the last cached answer when the server cannot be reached, and asks again next time', async () => {
    fetchFlags.mockRejectedValueOnce(new Error('offline'));
    getItem.mockResolvedValue(JSON.stringify(['weekly_forge']));

    await expect(loadFeatureFlags()).resolves.toEqual(['weekly_forge']);
    await loadFeatureFlags();
    expect(fetchFlags).toHaveBeenCalledTimes(2);
  });

  it('treats a malformed cache as no flags on', async () => {
    fetchFlags.mockRejectedValue(new Error('offline'));
    getItem.mockResolvedValue('{"not":"a list"}');

    await expect(loadFeatureFlags()).resolves.toEqual([]);
  });

  describe('useFeatureFlag', () => {
    it('is off until the server says otherwise, then on', async () => {
      const { result } = await renderHook(() => useFeatureFlag('weekly_forge'));

      await waitFor(() => expect(result.current).toBe(true));
    });

    it('stays off for a flag the server does not list', async () => {
      const { result } = await renderHook(() => useFeatureFlag('something_else'));

      await waitFor(() => expect(fetchFlags).toHaveBeenCalled());
      expect(result.current).toBe(false);
    });

    it('stays off when neither the server nor the cache can answer', async () => {
      fetchFlags.mockRejectedValue(new Error('offline'));
      getItem.mockRejectedValue(new Error('locked'));

      const { result } = await renderHook(() => useFeatureFlag('weekly_forge'));

      await waitFor(() => expect(fetchFlags).toHaveBeenCalled());
      expect(result.current).toBe(false);
    });
  });
});
