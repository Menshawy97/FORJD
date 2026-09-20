// ADR-048. A device-local copy of "the signed-in person allowed location for leaderboards", so a
// workout can decide at its start, with no network, whether to read a position at all. The server
// stays the authority (it re-checks consent on every upload and stores only the city); this only
// decides whether a coordinate is sent in the first place.
//
// Three states, not two: yes, no, and "not known yet" (nothing stored, which is what a fresh
// sign-in looks like). The third is what lets a workout ask the server once instead of guessing.
// The copy belongs to a sign-in: `clearSession` forgets it, so a different account on the same
// phone never inherits the previous person's yes. Every function degrades and never throws.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  LOCATION_CONSENT_STORAGE_KEY,
  forgetLocationConsent,
  readLocationConsent,
  rememberLocationConsent,
} from '../leaderboard-consent';

describe('leaderboard location consent cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  });

  it('lives under a forjd.* key, so deleting the account wipes it with the rest', () => {
    expect(LOCATION_CONSENT_STORAGE_KEY.startsWith('forjd.')).toBe(true);
  });

  describe('readLocationConsent', () => {
    it('is null ("not known yet") when nothing is stored', async () => {
      await expect(readLocationConsent()).resolves.toBeNull();
    });

    it('is true when the person has allowed it', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ enabled: true }));
      await expect(readLocationConsent()).resolves.toBe(true);
    });

    it('is false when they have withdrawn it', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ enabled: false }));
      await expect(readLocationConsent()).resolves.toBe(false);
    });

    it.each([
      ['not JSON', '{nope'],
      ['JSON of the wrong shape', JSON.stringify({ enabled: 'yes' })],
      ['a bare boolean', 'true'],
      ['null', 'null'],
    ])('is null, not a crash, for a stored value that is %s', async (_label, stored) => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored);
      await expect(readLocationConsent()).resolves.toBeNull();
    });

    it('is null, not a crash, when storage itself fails', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('disk'));
      await expect(readLocationConsent()).resolves.toBeNull();
    });
  });

  describe('rememberLocationConsent', () => {
    it('stores the flag', async () => {
      await rememberLocationConsent(true);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(LOCATION_CONSENT_STORAGE_KEY, JSON.stringify({ enabled: true }));
    });

    it('stores a withdrawal too', async () => {
      await rememberLocationConsent(false);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(LOCATION_CONSENT_STORAGE_KEY, JSON.stringify({ enabled: false }));
    });

    it('never throws into the screen that called it when storage fails', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('disk full'));
      await expect(rememberLocationConsent(true)).resolves.toBeUndefined();
    });
  });

  describe('forgetLocationConsent', () => {
    it('removes the stored flag, so the next sign-in starts not knowing', async () => {
      await forgetLocationConsent();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(LOCATION_CONSENT_STORAGE_KEY);
    });

    it('never throws, because it runs inside sign-out', async () => {
      (AsyncStorage.removeItem as jest.Mock).mockRejectedValue(new Error('disk'));
      await expect(forgetLocationConsent()).resolves.toBeUndefined();
    });
  });
});
