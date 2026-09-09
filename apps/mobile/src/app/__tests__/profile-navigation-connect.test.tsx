// Phase 7G. One navigation assertion per file — see
// profile-navigation-edit-profile.test.tsx for why.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('@/auth/apiClient', () => ({
  getMe: jest
    .fn()
    .mockResolvedValue({ id: 'u1', email: 'a@example.com', profile: null, privacy: null }),
  updateProfile: jest.fn(),
  updatePrivacy: jest.fn(),
  getWhoopStatus: jest.fn().mockResolvedValue({ connected: false, lastSyncAt: null }),
  connectWhoop: jest.fn(),
  disconnectWhoop: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

describe('profile tab navigation (Phase 7G) — connect', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('tapping Connected Sources opens the connect screen', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Connected Sources'));

    await findByText('Connect your data');
    expect(rendered.getPathname()).toBe('/connect');
  });
});
