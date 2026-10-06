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
import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_QUIET_HOURS } from '@forjd/domain';

import { getNotificationPreferences, patchNotificationPreferences } from '@/auth/apiClient';
import {
  NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY,
  queueNotificationChange,
  syncNotificationPreferences,
} from '../notification-preferences-sync';
import { NOTIFICATION_PREFERENCES_STORAGE_KEY } from '../notification-preferences';

const defaults = { ...DEFAULT_NOTIFICATION_PREFERENCES };
const serverRow = (over: Partial<typeof defaults> = {}) => ({
  ...defaults,
  ...over,
  // The server always answers its quiet hours now (the contract requires them); this sync only keeps the switches.
  quietHours: DEFAULT_QUIET_HOURS,
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

    expect(result).toEqual({ ...defaults, workout: false, rank: true });
    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? 'null')).toEqual(result);
  });

  it('adopts the 12E reminder switches the server sends', async () => {
    const data = useFakeStorage();
    (getNotificationPreferences as jest.Mock).mockResolvedValue(serverRow({ meals: true, weighIn: true }));

    const result = await syncNotificationPreferences();

    expect(result).toMatchObject({ meals: true, noWorkout: false, forgeClosing: false, weighIn: true });
    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? 'null')).toEqual(result);
  });

  it('does not copy the timestamp into the device copy', async () => {
    const data = useFakeStorage();
    (getNotificationPreferences as jest.Mock).mockResolvedValue(serverRow());

    await syncNotificationPreferences();

    expect(Object.keys(JSON.parse(data.get(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? '{}')).sort()).toEqual(
      ['forgeClosing', 'meals', 'noWorkout', 'pr', 'rank', 'recovery', 'weekly', 'weighIn', 'workout'],
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

// Review of 12D: the screen fires `queueNotificationChange` without waiting, so two quick taps run
// together. The work is serialised, so each tap sees the last one's result and none is lost.
describe('ordering (taps close together, taps during a send)', () => {
  // Lets the queued work run until it is waiting on the deferred promise the test controls.
  const letItRun = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps both changes when two switches are tapped before the first has finished saving', async () => {
    const data = useFakeStorage();
    (patchNotificationPreferences as jest.Mock).mockRejectedValue(new Error('offline'));

    const first = queueNotificationChange(defaults, { ...defaults, rank: true });
    const second = queueNotificationChange({ ...defaults, rank: true }, { ...defaults, rank: true, pr: false });
    await Promise.all([first, second]);

    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY) ?? 'null')).toEqual({
      rank: true,
      pr: false,
    });
  });

  it('sends a switch tapped while an earlier send is still in flight, after that send, and forgets both', async () => {
    const data = useFakeStorage();
    let finishFirst: (value: unknown) => void = () => undefined;
    (patchNotificationPreferences as jest.Mock)
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(serverRow());

    const first = queueNotificationChange(defaults, { ...defaults, rank: true });
    const second = queueNotificationChange({ ...defaults, rank: true }, { ...defaults, rank: true, pr: false });
    await letItRun();
    finishFirst(serverRow({ rank: true }));
    await Promise.all([first, second]);

    expect((patchNotificationPreferences as jest.Mock).mock.calls.map(([body]) => body)).toEqual([
      { rank: true },
      { pr: false },
    ]);
    expect(data.has(NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY)).toBe(false);
  });

  it("keeps the person's tap on the device copy when a slower server answer arrives after it", async () => {
    const data = useFakeStorage();
    let answerStale: (value: unknown) => void = () => undefined;
    (getNotificationPreferences as jest.Mock).mockImplementation(() => new Promise((resolve) => (answerStale = resolve)));
    (patchNotificationPreferences as jest.Mock).mockRejectedValue(new Error('offline'));

    const sync = syncNotificationPreferences();
    const tap = queueNotificationChange(defaults, { ...defaults, rank: true });
    await letItRun();
    answerStale(serverRow());
    await Promise.all([sync, tap]);

    expect(JSON.parse(data.get(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? 'null').rank).toBe(true);
  });
});
