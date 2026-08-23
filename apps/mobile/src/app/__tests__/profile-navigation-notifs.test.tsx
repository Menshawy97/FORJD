// Slice 2, phase I. One navigation assertion per file — see
// profile-navigation-edit-profile.test.tsx for why.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  getMe: jest
    .fn()
    .mockResolvedValue({ id: 'u1', email: 'a@example.com', profile: null, privacy: null }),
  updateProfile: jest.fn(),
  updatePrivacy: jest.fn(),
}));

// Mocked wholesale: the real module imports AsyncStorage, a native module with no Jest
// binding here. `notification-preferences.test.ts` is what pins the defaults to the spec.
jest.mock('@/store/notification-preferences', () => ({
  DEFAULT_NOTIFICATION_PREFERENCES: {
    workout: true,
    recovery: true,
    pr: true,
    rank: false,
    weekly: true,
  },
  loadNotificationPreferences: jest.fn().mockResolvedValue({
    workout: true,
    recovery: true,
    pr: true,
    rank: false,
    weekly: true,
  }),
  saveNotificationPreferences: jest.fn().mockResolvedValue(undefined),
}));

import * as SecureStore from 'expo-secure-store';

describe('profile tab navigation (slice 2) — notifs', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('tapping Notifications opens the notifications screen', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Notifications'));

    await findByText('Two rules: nothing at night, nothing you cannot act on.');
    expect(rendered.getPathname()).toBe('/notifs');
  });
});
