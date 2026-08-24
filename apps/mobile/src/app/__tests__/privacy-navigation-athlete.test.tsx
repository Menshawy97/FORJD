// Slice 2, phase J. One navigation assertion per file — see
// profile-navigation-edit-profile.test.tsx for why.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn().mockResolvedValue({
    id: 'u1',
    email: 'a@example.com',
    profile: null,
    privacy: {
      publicProfile: true,
      leaderboardOptIn: false,
      locationForLeaderboard: false,
      aiFeaturesConsent: false,
      aiFeaturesConsentAt: null,
      crashDiagnostics: false,
    },
  }),
  updateProfile: jest.fn(),
  updatePrivacy: jest.fn(),
  getAthlete: jest.fn().mockResolvedValue({
    userId: 'u1',
    displayName: 'Ada Lovelace',
    avatarUrl: null,
    city: 'Alexandria',
    trainingGoals: [],
    activities: [],
    isSelf: true,
  }),
}));

import * as SecureStore from 'expo-secure-store';

describe('privacy navigation (slice 2) — athlete', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('tapping Preview my public profile opens the athlete screen', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/privacy' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Preview my public profile'));

    await findByText('Your public profile');
    expect(rendered.getPathname()).toBe('/athlete/u1');
  });
});
