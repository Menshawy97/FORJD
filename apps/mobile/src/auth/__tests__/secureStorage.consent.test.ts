// ADR-048. The device's copy of the location consent belongs to a sign-in, so ending the session
// must forget it: otherwise a different account on the same phone would inherit the previous
// person's yes, and workouts would send a position for someone who never allowed it.
//
// Deliberately uses the REAL `clearSession` and the REAL consent module, mocking only the two
// storage engines beneath them. An earlier version of this design keyed the copy by a user id that
// nothing ever persisted; its tests mocked that lookup and passed while the feature could never
// have turned on. Nothing between the sign-out and the storage is mocked here.
jest.mock('expo-secure-store');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { clearSession, saveSession } from '../secureStorage';
import { LOCATION_CONSENT_STORAGE_KEY, readLocationConsent, rememberLocationConsent } from '@/store/leaderboard-consent';

describe('clearSession and the location consent copy', () => {
  let stored: string | null;

  beforeEach(() => {
    jest.clearAllMocks();
    stored = null;
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async () => stored);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (_key: string, value: string) => {
      stored = value;
    });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async () => {
      stored = null;
    });
  });

  it('forgets a stored yes when the session ends, so the next sign-in starts not knowing', async () => {
    await saveSession({ accessToken: 'a', refreshToken: 'r', expiresAt: '2026-01-01T00:00:00.000Z' });
    await rememberLocationConsent(true);
    await expect(readLocationConsent()).resolves.toBe(true);

    await clearSession();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(LOCATION_CONSENT_STORAGE_KEY);
    await expect(readLocationConsent()).resolves.toBeNull();
  });

  it('forgets it on a forced sign-out too (an expired session)', async () => {
    await rememberLocationConsent(true);

    await clearSession({ expired: true });

    await expect(readLocationConsent()).resolves.toBeNull();
  });

  it('still signs the person out when the consent copy cannot be removed', async () => {
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValue(new Error('disk'));

    await expect(clearSession()).resolves.toBeUndefined();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
  });
});
