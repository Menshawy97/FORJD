// Weekly Forge closes each athlete's week at midnight in their own zone (ADR-057 decision 3), so
// the phone tells the server its zone: on launch and when the app comes back to the foreground,
// but only when it differs from the last one sent. The "last sent" copy belongs to a sign-in, so a
// different account on the same phone sends its own. Never throws: this runs on app start.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('@/auth/apiClient', () => ({ putTimeZone: jest.fn(), deviceTimeZone: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { deviceTimeZone, putTimeZone } from '@/auth/apiClient';
import { TIME_ZONE_SENT_STORAGE_KEY, syncTimeZone } from '../time-zone-sync';

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

describe('syncTimeZone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
    (putTimeZone as jest.Mock).mockResolvedValue(undefined);
    (deviceTimeZone as jest.Mock).mockReturnValue('Africa/Cairo');
  });

  it('keeps its copy under a forjd.* key', () => {
    expect(TIME_ZONE_SENT_STORAGE_KEY.startsWith('forjd.')).toBe(true);
  });

  it('sends the phone zone the first time, and remembers it', async () => {
    await syncTimeZone();

    expect(putTimeZone).toHaveBeenCalledWith('Africa/Cairo');
    expect(setItem).toHaveBeenCalledWith(TIME_ZONE_SENT_STORAGE_KEY, 'Africa/Cairo');
  });

  it('sends nothing when the zone has not changed', async () => {
    getItem.mockResolvedValue('Africa/Cairo');

    await syncTimeZone();

    expect(putTimeZone).not.toHaveBeenCalled();
  });

  it('sends the new zone after the athlete travels', async () => {
    getItem.mockResolvedValue('Africa/Cairo');
    (deviceTimeZone as jest.Mock).mockReturnValue('Asia/Dubai');

    await syncTimeZone();

    expect(putTimeZone).toHaveBeenCalledWith('Asia/Dubai');
    expect(setItem).toHaveBeenCalledWith(TIME_ZONE_SENT_STORAGE_KEY, 'Asia/Dubai');
  });

  it('remembers nothing when the server refused, so the next launch tries again, and never throws', async () => {
    (putTimeZone as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(syncTimeZone()).resolves.toBeUndefined();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('still sends when the stored copy cannot be read', async () => {
    getItem.mockRejectedValue(new Error('locked'));

    await syncTimeZone();

    expect(putTimeZone).toHaveBeenCalledWith('Africa/Cairo');
  });
});
