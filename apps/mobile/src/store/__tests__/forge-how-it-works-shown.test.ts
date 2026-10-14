// Whether this account has already been shown Weekly Forge's How it works
// (docs/product/forge-how-it-works-once-plan.md). An account preference: forgotten at sign-out.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { forgetAccountPreferences } from '../account-preferences';
import {
  FORGE_HOW_IT_WORKS_SHOWN_STORAGE_KEY,
  hasSeenForgeHowItWorks,
  markForgeHowItWorksSeen,
} from '../forge-how-it-works-shown';

function fakeStorage(initial: Record<string, string> = {}) {
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

describe('the Weekly Forge How it works note', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is not seen when nothing is kept', async () => {
    fakeStorage();
    await expect(hasSeenForgeHowItWorks()).resolves.toBe(false);
  });

  it('is seen once marked', async () => {
    fakeStorage();
    await markForgeHowItWorksSeen();
    await expect(hasSeenForgeHowItWorks()).resolves.toBe(true);
  });

  it('counts as seen when the read fails, so nothing opens by itself', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('disk'));
    await expect(hasSeenForgeHowItWorks()).resolves.toBe(true);
  });

  it('does not throw when the write fails', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('disk'));
    await expect(markForgeHowItWorksSeen()).resolves.toBeUndefined();
  });

  it('is forgotten at sign-out, so the next account gets its own first look', async () => {
    const data = fakeStorage({ [FORGE_HOW_IT_WORKS_SHOWN_STORAGE_KEY]: '1' });
    await forgetAccountPreferences();
    expect(data.has(FORGE_HOW_IT_WORKS_SHOWN_STORAGE_KEY)).toBe(false);
  });
});
