// Emulator walk 2026-10-14, finding 4. The rest channel asked for `sound: 'default'`, which expo-notifications
// reads as a sound *file* named "default" and logs "Custom sound 'default' not found in native app" (a red
// error banner in development) before falling back to the phone's default sound. Leaving `sound` out gives
// the same default sound without the error. The channel keeps its high importance and vibration.
jest.mock('@/features/run/run-notification', () => ({ installForegroundNotificationHandler: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { HIGH: 4 },
}));

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { defaultScheduler } from '../rest-notifications';

describe('the rest timer channel (Android)', () => {
  const realOs = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: realOs, configurable: true });
  });

  it('uses the phone default sound by leaving sound out, and stays high importance with vibration', async () => {
    await defaultScheduler.ensureChannel();

    const [channelId, options] = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls[0] ?? [];
    expect(channelId).toBe('workout-rest');
    expect(options).not.toHaveProperty('sound');
    expect(options).toMatchObject({ importance: 4, vibrationPattern: [0, 250, 250, 250] });
  });
});
