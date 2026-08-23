// Slice 2, phase I. One navigation assertion per file — see
// profile-navigation-edit-profile.test.tsx for why.
//
// This is the test that makes Phase H's `?back=privacy` param real: `location.tsx` was built
// to accept it, with nothing in the app setting it until the privacy screen shipped.
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

describe('privacy navigation (slice 2) — location', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('tapping Location permission opens location with back=privacy', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/privacy' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Location permission'));

    await findByText('City Leaderboard Location');
    expect(rendered.getPathname()).toBe('/location');
    expect(rendered.getSearchParams()).toMatchObject({ back: 'privacy' });
  });
});
