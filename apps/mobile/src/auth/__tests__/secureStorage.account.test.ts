// Whole-app review 8.5, L3-1 and L5-2. Work finished on this phone is stamped with the account that
// did it, read offline from the stored access token, and sign-out forgets the per-account
// preferences so the next person to sign in does not inherit them.
//
// Like secureStorage.consent.test.ts, this uses the REAL `clearSession` and the REAL preference
// stores, mocking only the two storage engines beneath them.
jest.mock('expo-secure-store');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { clearSession, getAccountId, saveSession } from '../secureStorage';
import { EXERCISE_UNITS_STORAGE_KEY } from '@/store/exercise-unit-preferences';
import { NOTIFICATION_PREFERENCES_STORAGE_KEY } from '@/store/notification-preferences';
import { RECENT_EXERCISES_STORAGE_KEY } from '@/store/recent-exercises';

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function tokenFor(claims: Record<string, unknown>): string {
  return `${base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64Url(JSON.stringify(claims))}.signature`;
}

const session = (accessToken: string) => ({ accessToken, refreshToken: 'r', expiresAt: '2026-01-01T00:00:00.000Z' });

describe('the signed-in account id', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    await clearSession();
  });

  it("is the access token's subject, read without the network", async () => {
    await saveSession(session(tokenFor({ sub: 'a1b2c3d4-account', exp: 1 })));

    await expect(getAccountId()).resolves.toBe('a1b2c3d4-account');
  });

  it('follows a refreshed token for a different account', async () => {
    await saveSession(session(tokenFor({ sub: 'account-a' })));
    await saveSession(session(tokenFor({ sub: 'account-b' })));

    await expect(getAccountId()).resolves.toBe('account-b');
  });

  it('is null when nobody is signed in', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

    await expect(getAccountId()).resolves.toBeNull();
  });

  it('decodes without any global base64 helper, since the phone runtime may not provide one', async () => {
    const realAtob = globalThis.atob;
    // @ts-expect-error -- deliberately removed for this test.
    delete globalThis.atob;
    try {
      await saveSession(session(tokenFor({ sub: 'hermes-account', name: 'Zoë Ødegaard' })));
      await expect(getAccountId()).resolves.toBe('hermes-account');
    } finally {
      globalThis.atob = realAtob;
    }
  });

  it('is null, never a guess, for a token it cannot read', async () => {
    await saveSession(session('not-a-jwt'));
    await expect(getAccountId()).resolves.toBeNull();

    await saveSession(session(tokenFor({ email: 'no-subject@example.com' })));
    await expect(getAccountId()).resolves.toBeNull();
  });
});

describe('clearSession and the per-account preferences (L5-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  });

  it.each([
    ['a manual sign-out', undefined],
    ['a forced sign-out (an expired session)', { expired: true }],
  ])('forgets recent exercises, notification and unit preferences on %s', async (_label, options) => {
    await clearSession(options);

    const removed = (AsyncStorage.removeItem as jest.Mock).mock.calls.map(([key]) => key);
    expect(removed).toEqual(
      expect.arrayContaining([
        RECENT_EXERCISES_STORAGE_KEY,
        NOTIFICATION_PREFERENCES_STORAGE_KEY,
        EXERCISE_UNITS_STORAGE_KEY,
      ]),
    );
  });

  it('still signs out when forgetting a preference fails', async () => {
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValue(new Error('disk full'));

    await expect(clearSession()).resolves.toBeUndefined();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
  });
});
