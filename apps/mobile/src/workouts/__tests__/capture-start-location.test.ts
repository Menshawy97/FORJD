// ADR-048. What a workout does about location at its start, and only that: read a coarse position
// if, and only if, the signed-in person allowed it for leaderboards. It must never prompt (that is
// the Location screen's job), never hold the workout up, and never throw into a starting workout
// (CLAUDE.md rule 6: the network, and here the GPS, is never in the critical path).
//
// The device keeps a copy of the consent, which Home refreshes from the server. This never asks the
// server itself: a network call here could, in a rare refresh failure, sign the person out mid-set,
// so "not known yet" simply means no position this time.
const mockReadConsent = jest.fn();
jest.mock('@/store/leaderboard-consent', () => ({
  readLocationConsent: () => mockReadConsent(),
}));

// Present only to prove it is never used: capture must not touch the network.
const mockGetMe = jest.fn();
jest.mock('@/auth/apiClient', () => ({
  getMe: () => mockGetMe(),
}));

const mockReadPosition = jest.fn();
jest.mock('@/integrations/location/location-provider', () => ({
  readCoarsePosition: (...args: unknown[]) => mockReadPosition(...args),
}));

import { captureStartLocation } from '../capture-start-location';

const POSITION = { latitude: 31.202, longitude: 29.916 };

describe('captureStartLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadConsent.mockResolvedValue(true);
    mockReadPosition.mockResolvedValue(POSITION);
  });

  describe('when this device knows the person allowed it', () => {
    it('returns the coarse position', async () => {
      await expect(captureStartLocation()).resolves.toEqual(POSITION);
    });

    it('does not ask the server', async () => {
      await captureStartLocation();
      expect(mockGetMe).not.toHaveBeenCalled();
    });

    it('uses the adapter, which checks permission and never prompts, and its own timeout', async () => {
      await captureStartLocation();
      expect(mockReadPosition).toHaveBeenCalledTimes(1);
      expect(mockReadPosition).toHaveBeenCalledWith();
    });

    it('returns null when there is no position to give, for example permission is off or it timed out', async () => {
      mockReadPosition.mockResolvedValue(null);
      await expect(captureStartLocation()).resolves.toBeNull();
    });
  });

  describe('when this device knows the person has not allowed it', () => {
    it('reads nothing at all, and does not ask the server either', async () => {
      mockReadConsent.mockResolvedValue(false);

      await expect(captureStartLocation()).resolves.toBeNull();
      expect(mockReadPosition).not.toHaveBeenCalled();
      expect(mockGetMe).not.toHaveBeenCalled();
    });
  });

  describe('when this device does not know yet (a fresh sign-in)', () => {
    beforeEach(() => {
      mockReadConsent.mockResolvedValue(null);
    });

    it('reads no position this time, and never asks the server', async () => {
      await expect(captureStartLocation()).resolves.toBeNull();

      expect(mockReadPosition).not.toHaveBeenCalled();
      expect(mockGetMe).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('returns null rather than throwing when the consent read fails', async () => {
      mockReadConsent.mockRejectedValue(new Error('storage'));

      await expect(captureStartLocation()).resolves.toBeNull();
      expect(mockReadPosition).not.toHaveBeenCalled();
    });

    it('returns null rather than throwing when the position read fails', async () => {
      mockReadPosition.mockRejectedValue(new Error('gps'));

      await expect(captureStartLocation()).resolves.toBeNull();
    });
  });
});
