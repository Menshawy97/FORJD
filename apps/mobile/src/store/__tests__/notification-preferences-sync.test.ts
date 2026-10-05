// Phase 12D (docs/product/phase-12d-plan.md). The device copy (`notification-preferences.ts`) stays the
// cache the screen reads at once; this module sends the changed switch to the server and, on opening
// the screen, adopts the server's answer. The server wins. The switches are never in the critical
// path of a workout, so every failure here is silent and retried, never thrown.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('@/auth/apiClient', () => ({
  getNotificationPreferences: jest.fn(),
  patchNotificationPreferences: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getNotificationPreferences, patchNotificationPreferences } from '@/auth/apiClient';
import {
  NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY,
  queueNotificationChange,
  syncNotificationPreferences,
} from '../notification-preferences-sync';
import { NOTIFICATION_PREFERENCES_STORAGE_KEY } from '../notification-preferences';

const defaults = { workout: true, recovery: true, pr: true, rank: false, weekly: true };
const serverRow = (over: Partial<typeof defaults> = {}) => ({
  ...defaults,
  ...over,
  updatedAt: '2026-10-05T12:00:00.000Z',
});

/** An in-memory AsyncStorage, so the tests read what was written. */
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

describe('queueNotificationChange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends only the switch that changed', async () => {
    useFakeStorage();
    (patchNotificationPreferences as jest.Mock).mockResolvedValue(serverRow({ rank: true }));

    await queueNotificationChange(defaults, { ...defaults, rank: true });

    expect(patchNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(patchNotificationPreferences).toHaveBeenCalledWith({ rank: true });
  });

  it('sends nothing when nothing changed', async () => {
    useFakeStorage();

    await queueNotificationChange(defaults, defaults);

    expect(patchNotificationPreferences).not.toHaveBeenCalled();
  });

  it('forgets the change once the server has it', async () => {
    const data = useFakeStorage();
    (patchNotificationPreferences as jest.Mock).mockResolvedValue(serverRow({ rank: true }));

    await queueNotificationChange(defaults, { ...defaults, rank: true });

    expect(data.has(NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY)).toBe(false);
  });

  it('keeps the change for later when the send fails, and never throws', async () => {
    const data = useFakeStorage();
    (patchNotificationPreferences as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(queueNotificationChange(defaults, { ...defaults, rank: true })).resolves.toBeUndefined();

    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY) ?? 'null')).toEqual({ rank: true });
  });

  it('adds to what was already waiting, the newest value for a switch winning', async () => {
    const data = useFakeStorage({ [NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY]: JSON.stringify({ rank: true, pr: false }) });
    (patchNotificationPreferences as jest.Mock).mockRejectedValue(new Error('offline'));

    await queueNotificationChange({ ...defaults, rank: true, pr: false }, { ...defaults, rank: false, pr: false, weekly: false });

    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY) ?? 'null')).toEqual({
      rank: false,
      pr: false,
      weekly: false,
    });
  });
});

describe('syncNotificationPreferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("adopts the server's answer and keeps it as the device copy", async () => {
    const data = useFakeStorage();
    (getNotificationPreferences as jest.Mock).mockResolvedValue(serverRow({ rank: true, workout: false }));

    const result = await syncNotificationPreferences();

    expect(result).toEqual({ workout: false, recovery: true, pr: true, rank: true, weekly: true });
    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? 'null')).toEqual(result);
  });

  it('does not copy the timestamp into the device copy', async () => {
    const data = useFakeStorage();
    (getNotificationPreferences as jest.Mock).mockResolvedValue(serverRow());

    await syncNotificationPreferences();

    expect(Object.keys(JSON.parse(data.get(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? '{}')).sort()).toEqual(
      ['pr', 'rank', 'recovery', 'weekly', 'workout'],
    );
  });

  it('sends a change that was waiting before reading, so the server answer includes it', async () => {
    useFakeStorage({ [NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY]: JSON.stringify({ rank: true }) });
    const order: string[] = [];
    (patchNotificationPreferences as jest.Mock).mockImplementation(async () => {
      order.push('patch');
      return serverRow({ rank: true });
    });
    (getNotificationPreferences as jest.Mock).mockImplementation(async () => {
      order.push('get');
      return serverRow({ rank: true });
    });

    await syncNotificationPreferences();

    expect(order).toEqual(['patch', 'get']);
    expect(patchNotificationPreferences).toHaveBeenCalledWith({ rank: true });
  });

  it('leaves the device copy alone and answers null when a waiting change cannot be sent', async () => {
    const data = useFakeStorage({
      [NOTIFICATION_PREFERENCES_STORAGE_KEY]: JSON.stringify({ ...defaults, rank: true }),
      [NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY]: JSON.stringify({ rank: true }),
    });
    (patchNotificationPreferences as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(syncNotificationPreferences()).resolves.toBeNull();

    expect(getNotificationPreferences).not.toHaveBeenCalled();
    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? 'null').rank).toBe(true);
  });

  it('answers null and leaves the device copy alone when the server cannot be reached', async () => {
    const data = useFakeStorage({ [NOTIFICATION_PREFERENCES_STORAGE_KEY]: JSON.stringify({ ...defaults, pr: false }) });
    (getNotificationPreferences as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(syncNotificationPreferences()).resolves.toBeNull();

    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? 'null').pr).toBe(false);
  });

  it('answers null when the server sends something that is not the contract', async () => {
    useFakeStorage();
    (getNotificationPreferences as jest.Mock).mockResolvedValue({ workout: 'yes' });

    await expect(syncNotificationPreferences()).resolves.toBeNull();
  });
});
