// ADR-048. The location adapter: the only file that may touch `expo-location` (CLAUDE.md rule 4).
// The SDK is mocked at its module boundary; what is proven is the adapter's own behaviour: it
// asks for foreground permission only, never prompts while reading a position, rounds what it
// returns, gives up rather than hang, and never throws into a workout that is starting.
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetCurrentPosition = jest.fn();

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPosition(...args),
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3 },
}));

import {
  COARSE_DECIMALS,
  READ_TIMEOUT_MS,
  getPermissionStatus,
  readCoarsePosition,
  requestCoarsePermission,
} from '../location-provider';

const granted = { status: 'granted', granted: true, canAskAgain: true };
const denied = { status: 'denied', granted: false, canAskAgain: false };
const undetermined = { status: 'undetermined', granted: false, canAskAgain: true };
const fix = (latitude: number, longitude: number) => ({ coords: { latitude, longitude, accuracy: 500 } });

describe('location adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('getPermissionStatus', () => {
    it.each([
      [granted, 'granted'],
      [denied, 'denied'],
      [undetermined, 'undetermined'],
    ])('reports %j as %s', async (response, expected) => {
      mockGetPermissions.mockResolvedValue(response);
      await expect(getPermissionStatus()).resolves.toBe(expected);
    });

    it('never asks the person for anything', async () => {
      mockGetPermissions.mockResolvedValue(undetermined);
      await getPermissionStatus();
      expect(mockRequestPermissions).not.toHaveBeenCalled();
    });

    it('reports unavailable rather than throwing when the platform call fails', async () => {
      mockGetPermissions.mockRejectedValue(new Error('boom'));
      await expect(getPermissionStatus()).resolves.toBe('unavailable');
    });
  });

  describe('requestCoarsePermission', () => {
    it('asks once, for foreground location only', async () => {
      mockRequestPermissions.mockResolvedValue(granted);
      await requestCoarsePermission();
      expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
      expect(mockRequestPermissions).toHaveBeenCalledWith();
    });

    it('reports granted', async () => {
      mockRequestPermissions.mockResolvedValue(granted);
      await expect(requestCoarsePermission()).resolves.toBe('granted');
    });

    it.each([[denied], [undetermined]])('reports %j as denied', async (response) => {
      mockRequestPermissions.mockResolvedValue(response);
      await expect(requestCoarsePermission()).resolves.toBe('denied');
    });

    it('reports unavailable rather than throwing when the prompt itself fails', async () => {
      mockRequestPermissions.mockRejectedValue(new Error('no activity'));
      await expect(requestCoarsePermission()).resolves.toBe('unavailable');
    });
  });

  describe('readCoarsePosition', () => {
    it('is three decimal places, about 110 m', () => {
      expect(COARSE_DECIMALS).toBe(3);
    });

    it('returns the position rounded to three decimal places', async () => {
      mockGetPermissions.mockResolvedValue(granted);
      mockGetCurrentPosition.mockResolvedValue(fix(31.201765, 29.915824));
      await expect(readCoarsePosition()).resolves.toEqual({ latitude: 31.202, longitude: 29.916 });
    });

    it('asks for a low-accuracy fix, which is all a city needs and spares the battery', async () => {
      mockGetPermissions.mockResolvedValue(granted);
      mockGetCurrentPosition.mockResolvedValue(fix(1, 2));
      await readCoarsePosition();
      expect(mockGetCurrentPosition).toHaveBeenCalledWith({ accuracy: 2 });
    });

    it('never prompts, and reads nothing, when permission is not already granted', async () => {
      for (const response of [denied, undetermined]) {
        mockGetPermissions.mockResolvedValue(response);
        await expect(readCoarsePosition()).resolves.toBeNull();
      }
      expect(mockRequestPermissions).not.toHaveBeenCalled();
      expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    });

    it('returns null when the permission check itself fails', async () => {
      mockGetPermissions.mockRejectedValue(new Error('boom'));
      await expect(readCoarsePosition()).resolves.toBeNull();
      expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    });

    it('returns null rather than throwing when the read fails', async () => {
      mockGetPermissions.mockResolvedValue(granted);
      mockGetCurrentPosition.mockRejectedValue(new Error('location services are off'));
      await expect(readCoarsePosition()).resolves.toBeNull();
    });

    it.each([
      ['a fix with no coordinates', {}],
      ['NaN coordinates', fix(Number.NaN, 0)],
      ['out-of-range coordinates', fix(95, 0)],
      ['an out-of-range longitude', fix(0, 181)],
    ])('returns null for %s', async (_label, response) => {
      mockGetPermissions.mockResolvedValue(granted);
      mockGetCurrentPosition.mockResolvedValue(response);
      await expect(readCoarsePosition()).resolves.toBeNull();
    });

    it('gives up after the timeout instead of holding the workout up', async () => {
      jest.useFakeTimers();
      mockGetPermissions.mockResolvedValue(granted);
      mockGetCurrentPosition.mockReturnValue(new Promise(() => undefined));

      const pending = readCoarsePosition();
      await jest.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);

      await expect(pending).resolves.toBeNull();
    });

    it('gives up too when the permission check itself never answers', async () => {
      jest.useFakeTimers();
      mockGetPermissions.mockReturnValue(new Promise(() => undefined));

      const pending = readCoarsePosition();
      await jest.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);

      await expect(pending).resolves.toBeNull();
      expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    });

    it('leaves no timer running when permission is not granted', async () => {
      jest.useFakeTimers();
      mockGetPermissions.mockResolvedValue(denied);

      await readCoarsePosition();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('honours a shorter timeout when the caller asks for one', async () => {
      jest.useFakeTimers();
      mockGetPermissions.mockResolvedValue(granted);
      mockGetCurrentPosition.mockReturnValue(new Promise(() => undefined));

      const pending = readCoarsePosition(200);
      await jest.advanceTimersByTimeAsync(201);

      await expect(pending).resolves.toBeNull();
    });

    it('leaves no timer running once it has an answer', async () => {
      jest.useFakeTimers();
      mockGetPermissions.mockResolvedValue(granted);
      mockGetCurrentPosition.mockResolvedValue(fix(1, 2));

      await readCoarsePosition();

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
