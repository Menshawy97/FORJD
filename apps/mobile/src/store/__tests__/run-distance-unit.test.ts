// The phone's copy of the Units distance choice, so a run shows miles without signal (docs/product/run-miles-plan.md,
// rule 6). Kilometres when nothing is kept or the copy is unreadable; forgotten at sign-out like the other account
// preferences.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { forgetAccountPreferences } from '../account-preferences';
import { loadRunDistanceUnit, RUN_DISTANCE_UNIT_STORAGE_KEY, saveRunDistanceUnit } from '../run-distance-unit';

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

describe('the run distance unit on the phone', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is kilometres when nothing is kept', async () => {
    fakeStorage();

    await expect(loadRunDistanceUnit()).resolves.toBe('km');
  });

  it('keeps miles and answers it back', async () => {
    fakeStorage();

    await saveRunDistanceUnit('mi');

    await expect(loadRunDistanceUnit()).resolves.toBe('mi');
  });

  it('reads anything else, or a failed read, as kilometres', async () => {
    fakeStorage({ [RUN_DISTANCE_UNIT_STORAGE_KEY]: 'furlongs' });
    await expect(loadRunDistanceUnit()).resolves.toBe('km');

    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('disk'));
    await expect(loadRunDistanceUnit()).resolves.toBe('km');
  });

  it('never throws when it cannot be kept', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('disk'));

    await expect(saveRunDistanceUnit('mi')).resolves.toBeUndefined();
  });

  it('is forgotten at sign-out with the other account preferences', async () => {
    const data = fakeStorage({ [RUN_DISTANCE_UNIT_STORAGE_KEY]: 'mi' });

    await forgetAccountPreferences();

    expect(data.has(RUN_DISTANCE_UNIT_STORAGE_KEY)).toBe(false);
  });
});
