// The quiet-hours editor, phone side. A chosen window is kept on the phone at once, sent to the server, and kept for
// the next sync when it cannot be sent. The server wins when the screen opens (owner decision for the switches,
// 2026-10-05, applied the same way), and an older server that does not send quiet hours changes nothing.
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
import { queueQuietHoursChange, syncNotificationPreferences } from '../notification-preferences-sync';
import { loadQuietHours, QUIET_HOURS_PENDING_STORAGE_KEY, QUIET_HOURS_STORAGE_KEY } from '../quiet-hours';

const NIGHT = { startMinute: 1380, endMinute: 360 };
const AFTERNOON = { startMinute: 780, endMinute: 900 };

const serverRow = (quietHours: unknown = DEFAULT_QUIET_HOURS) => ({
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  quietHours,
  updatedAt: '2026-10-06T12:00:00.000Z',
});

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

describe('queueQuietHoursChange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the window on the phone and sends it whole, nothing else', async () => {
    const data = useFakeStorage();
    (patchNotificationPreferences as jest.Mock).mockResolvedValue(serverRow(NIGHT));

    await queueQuietHoursChange(NIGHT);

    expect(JSON.parse(data.get(QUIET_HOURS_STORAGE_KEY) as string)).toEqual(NIGHT);
    expect(patchNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(patchNotificationPreferences).toHaveBeenCalledWith({ quietHours: NIGHT });
  });

  it('forgets the change once the server has it', async () => {
    const data = useFakeStorage();
    (patchNotificationPreferences as jest.Mock).mockResolvedValue(serverRow(NIGHT));

    await queueQuietHoursChange(NIGHT);

    expect(data.has(QUIET_HOURS_PENDING_STORAGE_KEY)).toBe(false);
  });

  it('keeps the change for the next sync when it cannot be sent, and never throws', async () => {
    const data = useFakeStorage();
    (patchNotificationPreferences as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(queueQuietHoursChange(NIGHT)).resolves.toBeUndefined();

    expect(JSON.parse(data.get(QUIET_HOURS_PENDING_STORAGE_KEY) as string)).toEqual(NIGHT);
    await expect(loadQuietHours()).resolves.toEqual(NIGHT);
  });

  it('sends two quick changes in order, so the later one wins and nothing is left waiting', async () => {
    const data = useFakeStorage();
    let release: () => void = () => undefined;
    (patchNotificationPreferences as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(serverRow(NIGHT));
          }),
      )
      .mockResolvedValue(serverRow(AFTERNOON));

    const first = queueQuietHoursChange(NIGHT);
    const second = queueQuietHoursChange(AFTERNOON);
    // The first send is on its way and held; the second must not start until it is done.
    for (let turn = 0; turn < 50 && (patchNotificationPreferences as jest.Mock).mock.calls.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(patchNotificationPreferences).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);

    expect(patchNotificationPreferences).toHaveBeenCalledTimes(2);
    expect(patchNotificationPreferences).toHaveBeenLastCalledWith({ quietHours: AFTERNOON });
    expect(JSON.parse(data.get(QUIET_HOURS_STORAGE_KEY) as string)).toEqual(AFTERNOON);
    expect(data.has(QUIET_HOURS_PENDING_STORAGE_KEY)).toBe(false);
  });
});

describe('syncNotificationPreferences and the quiet hours', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("adopts the server's quiet hours as the device copy", async () => {
    useFakeStorage();
    (getNotificationPreferences as jest.Mock).mockResolvedValue(serverRow(NIGHT));

    const switches = await syncNotificationPreferences();

    expect(switches).toMatchObject({ workout: true });
    await expect(loadQuietHours()).resolves.toEqual(NIGHT);
  });

  it('sends a change that was waiting before it reads, so the server answer already has it', async () => {
    useFakeStorage({ [QUIET_HOURS_PENDING_STORAGE_KEY]: JSON.stringify(AFTERNOON) });
    (patchNotificationPreferences as jest.Mock).mockResolvedValue(serverRow(AFTERNOON));
    (getNotificationPreferences as jest.Mock).mockResolvedValue(serverRow(AFTERNOON));

    await syncNotificationPreferences();

    expect(patchNotificationPreferences).toHaveBeenCalledWith({ quietHours: AFTERNOON });
    await expect(loadQuietHours()).resolves.toEqual(AFTERNOON);
  });

  it('leaves the device copy alone and answers null when a waiting change cannot be sent', async () => {
    useFakeStorage({
      [QUIET_HOURS_STORAGE_KEY]: JSON.stringify(AFTERNOON),
      [QUIET_HOURS_PENDING_STORAGE_KEY]: JSON.stringify(AFTERNOON),
    });
    (patchNotificationPreferences as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(syncNotificationPreferences()).resolves.toBeNull();

    expect(getNotificationPreferences).not.toHaveBeenCalled();
    await expect(loadQuietHours()).resolves.toEqual(AFTERNOON);
  });

  it('still adopts the switches from an older server that sends no quiet hours, and keeps the device quiet hours', async () => {
    useFakeStorage({ [QUIET_HOURS_STORAGE_KEY]: JSON.stringify(NIGHT) });
    // An older server: the switches and the timestamp, no quiet hours.
    const older = { ...DEFAULT_NOTIFICATION_PREFERENCES, rank: true, updatedAt: '2026-10-06T12:00:00.000Z' };
    (getNotificationPreferences as jest.Mock).mockResolvedValue(older);

    const switches = await syncNotificationPreferences();

    expect(switches).toMatchObject({ rank: true });
    await expect(loadQuietHours()).resolves.toEqual(NIGHT);
  });

  it('does not adopt quiet hours that are not a valid window, and answers null like any bad answer', async () => {
    useFakeStorage({ [QUIET_HOURS_STORAGE_KEY]: JSON.stringify(NIGHT) });
    (getNotificationPreferences as jest.Mock).mockResolvedValue(serverRow({ startMinute: 600, endMinute: 600 }));

    await expect(syncNotificationPreferences()).resolves.toBeNull();

    await expect(loadQuietHours()).resolves.toEqual(NIGHT);
  });
});
