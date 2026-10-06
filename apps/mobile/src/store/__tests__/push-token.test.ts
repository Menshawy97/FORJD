// The push token this install registered (Phase 12F slice 4): kept so sign-out can take it off the server and so a
// recent registration is not repeated, and forgotten on sign-out like the other device copies of account settings.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { forgetAccountPreferences } from '../account-preferences';
import { clearPushToken, loadPushToken, PUSH_TOKEN_STORAGE_KEY, savePushToken } from '../push-token';

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

describe('the stored push token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps what was saved and answers it back', async () => {
    fakeStorage();

    await savePushToken({ token: 'ExponentPushToken[abc]', registeredAt: 123 });

    await expect(loadPushToken()).resolves.toEqual({ token: 'ExponentPushToken[abc]', registeredAt: 123 });
  });

  it('answers null when nothing is stored or what is stored is not a token and a time', async () => {
    for (const bad of [undefined, 'not json', 'null', '"x"', JSON.stringify({ token: '', registeredAt: 1 }), JSON.stringify({ token: 'a' }), JSON.stringify({ token: 1, registeredAt: 1 })]) {
      fakeStorage(bad === undefined ? {} : { [PUSH_TOKEN_STORAGE_KEY]: bad });
      await expect(loadPushToken()).resolves.toBeNull();
    }
  });

  it('never throws when the storage fails', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('disk'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('disk'));
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValue(new Error('disk'));

    await expect(loadPushToken()).resolves.toBeNull();
    await expect(savePushToken({ token: 't', registeredAt: 1 })).resolves.toBeUndefined();
    await expect(clearPushToken()).resolves.toBeUndefined();
  });

  it('is forgotten on sign-out with the other device copies of account settings', async () => {
    const data = fakeStorage({ [PUSH_TOKEN_STORAGE_KEY]: JSON.stringify({ token: 'ExponentPushToken[abc]', registeredAt: 1 }) });

    await forgetAccountPreferences();

    expect(data.has(PUSH_TOKEN_STORAGE_KEY)).toBe(false);
  });
});
