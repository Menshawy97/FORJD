// Phase 12E-8. The monthly weigh-in reminder counts from the latest scan; with none, from the day the switch
// was turned on. That day is kept on the phone (a date, nothing about the body) and forgotten on sign-out.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { forgetAccountPreferences } from '../account-preferences';
import { clearWeighInSince, getOrSetWeighInSince, WEIGH_IN_SINCE_STORAGE_KEY } from '../weigh-in-reminder-anchor';

function useFakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => data.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    data.set(key, value);
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    data.delete(key);
  });
  return data;
}

describe('weigh-in reminder anchor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps today the first time, and answers the same day afterwards', async () => {
    const data = useFakeStorage();

    await expect(getOrSetWeighInSince('2026-10-07')).resolves.toBe('2026-10-07');
    await expect(getOrSetWeighInSince('2026-10-20')).resolves.toBe('2026-10-07');

    expect(data.get(WEIGH_IN_SINCE_STORAGE_KEY)).toBe('2026-10-07');
  });

  it('replaces a stored value that is not a date', async () => {
    useFakeStorage({ [WEIGH_IN_SINCE_STORAGE_KEY]: 'yesterday' });

    await expect(getOrSetWeighInSince('2026-10-07')).resolves.toBe('2026-10-07');
  });

  it('starts over after it is cleared (the switch was turned off)', async () => {
    useFakeStorage({ [WEIGH_IN_SINCE_STORAGE_KEY]: '2026-09-01' });

    await clearWeighInSince();

    await expect(getOrSetWeighInSince('2026-10-07')).resolves.toBe('2026-10-07');
  });

  it('never throws when storage fails, and counts from today', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('storage'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('storage'));
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValue(new Error('storage'));

    await expect(getOrSetWeighInSince('2026-10-07')).resolves.toBe('2026-10-07');
    await expect(clearWeighInSince()).resolves.toBeUndefined();
  });

  it('is forgotten on sign-out, so the next account on the phone counts from its own day', async () => {
    const data = useFakeStorage({ [WEIGH_IN_SINCE_STORAGE_KEY]: '2026-09-01' });

    await forgetAccountPreferences();

    expect(data.has(WEIGH_IN_SINCE_STORAGE_KEY)).toBe(false);
  });
});
