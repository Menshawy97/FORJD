// Plan step 3. AsyncStorage behind a seam: these preferences are device-local only until push
// exists (Phase 6/8), at which point this file becomes an adapter swap rather than a screen
// rewrite. Defaults come from slice2-screen-specs.md §5.4 — note `rank: false`, the one that
// starts off.
//
// Returning defaults (rather than throwing) on a corrupt stored value is deliberate: the
// screen has no error UI for this, and a malformed preferences blob should degrade to "the
// documented defaults", not a crash.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '../notification-preferences';

describe('notification preferences store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('has the spec defaults, with Leaderboard moves off', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      workout: true,
      recovery: true,
      pr: true,
      rank: false,
      weekly: true,
    });
  });

  it('returns the defaults when nothing is stored', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    await expect(loadNotificationPreferences()).resolves.toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });

  it('returns the stored value when one exists', async () => {
    const stored = { workout: false, recovery: false, pr: false, rank: true, weekly: false };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(stored));

    await expect(loadNotificationPreferences()).resolves.toEqual(stored);
  });

  it('returns the defaults on a corrupt stored value rather than throwing', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{not json at all');

    await expect(loadNotificationPreferences()).resolves.toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });

  it('returns the defaults when the stored value is valid JSON of the wrong shape', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ workout: 'yes' }));

    await expect(loadNotificationPreferences()).resolves.toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });

  it('persists under a single key', async () => {
    const next = { workout: false, recovery: true, pr: true, rank: true, weekly: false };

    await expect(saveNotificationPreferences(next)).resolves.toBe(true);

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
    expect(typeof key).toBe('string');
    expect(JSON.parse(value)).toEqual(next);
  });

  // The notifs screen calls this fire-and-forget (no Save button, no error surface), so a
  // rejection here would surface as an unhandled promise rejection while the UI already
  // shows the new state. Resolving false keeps the swallow deliberate and observable.
  it('resolves false rather than rejecting when the write fails', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('disk full'));

    await expect(
      saveNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES),
    ).resolves.toBe(false);
  });
});
