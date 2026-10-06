// The quiet-hours editor, phone side. The device copy of the person's quiet hours (the server is the home of the
// choice, see notification-preferences-sync.ts) plus the small pure helpers the screen and the picker share.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_QUIET_HOURS } from '@forjd/domain';

import { dateToMinute, formatClock, formatQuietHours, minuteToDate } from '@/features/notifications/quiet-hours-format';
import { forgetAccountPreferences } from '../account-preferences';
import {
  loadQuietHours,
  QUIET_HOURS_PENDING_STORAGE_KEY,
  QUIET_HOURS_STORAGE_KEY,
  saveQuietHours,
} from '../quiet-hours';

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

describe('loadQuietHours', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('answers 22:00 to 07:00 when nothing was saved', async () => {
    fakeStorage();

    await expect(loadQuietHours()).resolves.toEqual(DEFAULT_QUIET_HOURS);
  });

  it('answers what was saved', async () => {
    fakeStorage({ [QUIET_HOURS_STORAGE_KEY]: JSON.stringify({ startMinute: 1380, endMinute: 360 }) });

    await expect(loadQuietHours()).resolves.toEqual({ startMinute: 1380, endMinute: 360 });
  });

  it('falls back to the default for anything it cannot trust', async () => {
    for (const bad of [
      'not json',
      'null',
      '"22:00"',
      JSON.stringify({ startMinute: 600, endMinute: 600 }),
      JSON.stringify({ startMinute: -1, endMinute: 420 }),
      JSON.stringify({ startMinute: 1320, endMinute: 1440 }),
      JSON.stringify({ startMinute: 1320 }),
      JSON.stringify({ startMinute: '1320', endMinute: '420' }),
    ]) {
      fakeStorage({ [QUIET_HOURS_STORAGE_KEY]: bad });
      await expect(loadQuietHours()).resolves.toEqual(DEFAULT_QUIET_HOURS);
    }
  });

  it('falls back to the default when the storage itself fails', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('disk'));

    await expect(loadQuietHours()).resolves.toEqual(DEFAULT_QUIET_HOURS);
  });
});

describe('saveQuietHours', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the window so the next load answers it', async () => {
    fakeStorage();

    await expect(saveQuietHours({ startMinute: 1260, endMinute: 480 })).resolves.toBe(true);

    await expect(loadQuietHours()).resolves.toEqual({ startMinute: 1260, endMinute: 480 });
  });

  it('answers false rather than throwing when it cannot write', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('disk full'));

    await expect(saveQuietHours({ startMinute: 1260, endMinute: 480 })).resolves.toBe(false);
  });
});

describe('the quiet-hours copies belong to one signed-in person', () => {
  it('forgets both the device copy and the unsent change on sign-out', async () => {
    const data = fakeStorage({
      [QUIET_HOURS_STORAGE_KEY]: JSON.stringify({ startMinute: 1380, endMinute: 360 }),
      [QUIET_HOURS_PENDING_STORAGE_KEY]: JSON.stringify({ startMinute: 1380, endMinute: 360 }),
    });

    await forgetAccountPreferences();

    expect(data.has(QUIET_HOURS_STORAGE_KEY)).toBe(false);
    expect(data.has(QUIET_HOURS_PENDING_STORAGE_KEY)).toBe(false);
  });
});

describe('formatting and the picker', () => {
  it('writes a minute of the day as a 24-hour clock', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(7 * 60)).toBe('07:00');
    expect(formatClock(22 * 60 + 5)).toBe('22:05');
    expect(formatClock(1439)).toBe('23:59');
  });

  it('writes the window with an em dash and a space either side', () => {
    expect(formatQuietHours(DEFAULT_QUIET_HOURS)).toBe('22:00 — 07:00');
    expect(formatQuietHours({ startMinute: 13 * 60, endMinute: 15 * 60 + 30 })).toBe('13:00 — 15:30');
  });

  it('turns a minute into a time for the picker and back, in the phone local time', () => {
    const date = minuteToDate(22 * 60 + 15);

    expect(date.getHours()).toBe(22);
    expect(date.getMinutes()).toBe(15);
    expect(dateToMinute(date)).toBe(22 * 60 + 15);
    expect(dateToMinute(new Date(2026, 5, 1, 0, 0))).toBe(0);
  });
});
