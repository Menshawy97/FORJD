// Slice 2, phase I. One navigation assertion per file — see
// profile-navigation-edit-profile.test.tsx for why: expo-router's testing-library keeps
// navigation state that outlives a single `it()` block, so a second test in the same file
// does not reliably start back at `/profile`.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn().mockResolvedValue({
    id: 'u1',
    email: 'a@example.com',
    profile: null,
    privacy: {
      publicProfile: false,
      leaderboardOptIn: false,
      locationForLeaderboard: false,
      aiFeaturesConsent: false,
      aiFeaturesConsentAt: null,
      crashDiagnostics: false,
    },
  }),
  updateProfile: jest.fn(),
  updatePrivacy: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

describe('profile tab navigation (slice 2) — privacy', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('tapping Privacy Settings opens the privacy screen', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Privacy Settings'));

    await findByText('Appear on city leaderboards');
    expect(rendered.getPathname()).toBe('/privacy');
  });
});
