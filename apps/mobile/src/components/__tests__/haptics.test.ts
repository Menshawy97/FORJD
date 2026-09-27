// The one seam over expo-haptics (approved with Weekly Forge's Phase 7 mock-ups): a light tap for a
// level-up, medium for a new band, and heavy then a success buzz for Forged. Everything else mocks
// this file, not expo-haptics. A phone without a vibration motor rejects; that is never an error.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));

import * as Haptics from 'expo-haptics';

import { hapticForged, hapticLevelUp, hapticNewBand } from '../haptics';

const impact = Haptics.impactAsync as jest.Mock;
const notify = Haptics.notificationAsync as jest.Mock;

describe('haptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    impact.mockResolvedValue(undefined);
    notify.mockResolvedValue(undefined);
  });

  it('taps lightly for a level-up', async () => {
    await hapticLevelUp();

    expect(impact).toHaveBeenCalledWith('light');
  });

  it('taps harder for a new band', async () => {
    await hapticNewBand();

    expect(impact).toHaveBeenCalledWith('medium');
  });

  it('strikes heavily, then buzzes success, for Forged', async () => {
    await hapticForged();

    expect(impact).toHaveBeenCalledWith('heavy');
    expect(notify).toHaveBeenCalledWith('success');
    expect(impact.mock.invocationCallOrder[0]).toBeLessThan(notify.mock.invocationCallOrder[0]!);
  });

  it('never throws when the phone cannot vibrate', async () => {
    impact.mockRejectedValue(new Error('no motor'));
    notify.mockRejectedValue(new Error('no motor'));

    await expect(hapticLevelUp()).resolves.toBeUndefined();
    await expect(hapticForged()).resolves.toBeUndefined();
  });
});
