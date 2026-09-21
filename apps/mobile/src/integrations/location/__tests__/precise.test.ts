// ADR-049. The run screen's precise, foreground-only position. The SDK is mocked at its module
// boundary; what is proven is the adapter's own behaviour: precise permission is asked in one
// function and never while watching, a coarse-only grant is told apart from a precise one, fixes
// are passed on at full precision but only when valid, and stopping is safe to do twice.
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockWatchPosition = jest.fn();
const mockAccuracy = { Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 };

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  watchPositionAsync: (...args: unknown[]) => mockWatchPosition(...args),
  Accuracy: { Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}));

import { getPrecisePermission, requestPrecisePermission, watchPrecisePosition } from '../location-provider';

const granted = { status: 'granted', granted: true, canAskAgain: true };
const grantedFine = { ...granted, android: { accuracy: 'fine' } };
const grantedCoarse = { ...granted, android: { accuracy: 'coarse' } };
const denied = { status: 'denied', granted: false, canAskAgain: false };
const undetermined = { status: 'undetermined', granted: false, canAskAgain: true };

const reading = (over: Record<string, unknown> = {}) => ({
  coords: {
    latitude: 31.2001234,
    longitude: 29.9187654,
    altitude: 12.5,
    accuracy: 6.2,
    ...over,
  },
  timestamp: 1_700_000_000_000,
});

describe('precise location adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestPrecisePermission', () => {
    it('asks once, for foreground location only', async () => {
      mockRequestPermissions.mockResolvedValue(grantedFine);
      await requestPrecisePermission();
      expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
      expect(mockRequestPermissions).toHaveBeenCalledWith();
    });

    it.each([
      [grantedFine, 'granted'],
      [granted, 'granted'], // iOS reports no Android accuracy field
      [grantedCoarse, 'coarse_only'],
      [denied, 'denied'],
      [undetermined, 'denied'],
    ])('reports %j as %s', async (response, expected) => {
      mockRequestPermissions.mockResolvedValue(response);
      await expect(requestPrecisePermission()).resolves.toBe(expected);
    });

    it('reports unavailable rather than throwing when the platform call fails', async () => {
      mockRequestPermissions.mockRejectedValue(new Error('boom'));
      await expect(requestPrecisePermission()).resolves.toBe('unavailable');
    });
  });

  describe('getPrecisePermission', () => {
    it.each([
      [grantedFine, 'granted'],
      [grantedCoarse, 'coarse_only'],
      [denied, 'denied'],
      [undetermined, 'undetermined'],
    ])('reports %j as %s', async (response, expected) => {
      mockGetPermissions.mockResolvedValue(response);
      await expect(getPrecisePermission()).resolves.toBe(expected);
    });

    it('never asks the person for anything', async () => {
      mockGetPermissions.mockResolvedValue(undetermined);
      await getPrecisePermission();
      expect(mockRequestPermissions).not.toHaveBeenCalled();
    });

    it('reports unavailable rather than throwing', async () => {
      mockGetPermissions.mockRejectedValue(new Error('boom'));
      await expect(getPrecisePermission()).resolves.toBe('unavailable');
    });
  });

  describe('watchPrecisePosition', () => {
    const remove = jest.fn();

    beforeEach(() => {
      mockGetPermissions.mockResolvedValue(grantedFine);
      mockWatchPosition.mockResolvedValue({ remove });
    });

    it('never prompts, even when permission is missing', async () => {
      mockGetPermissions.mockResolvedValue(undetermined);
      await watchPrecisePosition(jest.fn());
      expect(mockRequestPermissions).not.toHaveBeenCalled();
    });

    it.each([
      [denied, 'denied'],
      [undetermined, 'denied'],
      [grantedCoarse, 'coarse_only'],
    ])('does not start for %j, and says why (%s)', async (response, expected) => {
      mockGetPermissions.mockResolvedValue(response);
      const result = await watchPrecisePosition(jest.fn());
      expect(result.status).toBe(expected);
      expect(mockWatchPosition).not.toHaveBeenCalled();
    });

    it('starts a best-accuracy watch, about once a second and every couple of metres', async () => {
      const result = await watchPrecisePosition(jest.fn());
      expect(result.status).toBe('watching');
      // The mock's Accuracy table is ours, so this proves the adapter asks for BestForNavigation by
      // name, not that the literal is right.
      expect(mockWatchPosition).toHaveBeenCalledWith(
        expect.objectContaining({ accuracy: mockAccuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 }),
        expect.any(Function),
      );
    });

    it('passes each fix on at full precision, unrounded', async () => {
      const onFix = jest.fn();
      await watchPrecisePosition(onFix);
      const callback = mockWatchPosition.mock.calls[0]?.[1] as (reading: unknown) => void;

      callback(reading());

      expect(onFix).toHaveBeenCalledWith({
        latitude: 31.2001234,
        longitude: 29.9187654,
        altitudeMeters: 12.5,
        accuracyMeters: 6.2,
        timestampMs: 1_700_000_000_000,
      });
    });

    it('reports an altitude or accuracy the phone did not give as null', async () => {
      const onFix = jest.fn();
      await watchPrecisePosition(onFix);
      const callback = mockWatchPosition.mock.calls[0]?.[1] as (reading: unknown) => void;

      callback(reading({ altitude: null, accuracy: null }));

      expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ altitudeMeters: null, accuracyMeters: null }));
    });

    it.each([
      ['a NaN latitude', { latitude: NaN }],
      ['an infinite longitude', { longitude: Infinity }],
      ['a latitude out of range', { latitude: 91 }],
      ['a longitude out of range', { longitude: -181 }],
    ])('drops a fix with %s instead of passing it on', async (_label, over) => {
      const onFix = jest.fn();
      await watchPrecisePosition(onFix);
      const callback = mockWatchPosition.mock.calls[0]?.[1] as (reading: unknown) => void;

      callback(reading(over));

      expect(onFix).not.toHaveBeenCalled();
    });

    it('treats a non-numeric altitude as unknown', async () => {
      const onFix = jest.fn();
      await watchPrecisePosition(onFix);
      const callback = mockWatchPosition.mock.calls[0]?.[1] as (reading: unknown) => void;

      callback(reading({ altitude: NaN }));

      expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ altitudeMeters: null }));
    });

    it('stops the watch, once, however many times stop is called', async () => {
      const result = await watchPrecisePosition(jest.fn());
      if (result.status !== 'watching') throw new Error('expected a watch');

      result.stop();
      result.stop();

      expect(remove).toHaveBeenCalledTimes(1);
    });

    it('ignores fixes that arrive after stop', async () => {
      const onFix = jest.fn();
      const result = await watchPrecisePosition(onFix);
      if (result.status !== 'watching') throw new Error('expected a watch');
      const callback = mockWatchPosition.mock.calls[0]?.[1] as (reading: unknown) => void;

      result.stop();
      callback(reading());

      expect(onFix).not.toHaveBeenCalled();
    });

    it('removes the subscription itself when the run was cancelled while the watch was starting', async () => {
      // The caller has no handle until the promise resolves, so an unmount in that window would
      // otherwise leave a best-accuracy watch running for the rest of the session.
      let cancelled = false;
      mockWatchPosition.mockImplementation(async () => {
        cancelled = true; // the person left the screen while the native call was in flight
        return { remove };
      });

      const result = await watchPrecisePosition(jest.fn(), { isCancelled: () => cancelled });

      expect(remove).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: 'cancelled' });
    });

    it('does not start the watch at all when it was cancelled before permission came back', async () => {
      const result = await watchPrecisePosition(jest.fn(), { isCancelled: () => true });

      expect(mockWatchPosition).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'cancelled' });
    });

    it('keeps watching when the run is not cancelled', async () => {
      const result = await watchPrecisePosition(jest.fn(), { isCancelled: () => false });

      expect(result.status).toBe('watching');
      expect(remove).not.toHaveBeenCalled();
    });

    it('does not throw from stop when the subscription cannot be removed', async () => {
      remove.mockImplementationOnce(() => {
        throw new Error('already removed');
      });
      const result = await watchPrecisePosition(jest.fn());
      if (result.status !== 'watching') throw new Error('expected a watch');

      expect(() => result.stop()).not.toThrow();
    });

    it('reports unavailable when permission cannot be read inside the watch', async () => {
      mockGetPermissions.mockRejectedValue(new Error('boom'));
      await expect(watchPrecisePosition(jest.fn())).resolves.toEqual({ status: 'unavailable' });
    });

    it('reports unavailable rather than throwing when the watch cannot start', async () => {
      mockWatchPosition.mockRejectedValue(new Error('location services off'));
      await expect(watchPrecisePosition(jest.fn())).resolves.toEqual({ status: 'unavailable' });
    });

    it('does not let a throwing listener take the watch down', async () => {
      const onFix = jest.fn(() => {
        throw new Error('listener bug');
      });
      await watchPrecisePosition(onFix);
      const callback = mockWatchPosition.mock.calls[0]?.[1] as (reading: unknown) => void;

      expect(() => callback(reading())).not.toThrow();
    });
  });
});
