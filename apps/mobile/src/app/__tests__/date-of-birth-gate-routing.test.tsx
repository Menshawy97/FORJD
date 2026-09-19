// ADR-042. A signed-in account whose profile has no date of birth -- created before the age
// check existed, a sign-up interrupted before that step, or a first Google/Apple sign-in --
// must be sent to the "Your Profile" step wherever it opens the app, and cannot use the rest.
//
// One navigation assertion per file: expo-router's testing library keeps navigation state that
// outlives a single `it()` (see profile-navigation-edit-profile.test.tsx).
import { renderApp } from './render-app';

jest.mock('expo-secure-store');
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));
jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn().mockResolvedValue({
    id: 'u1',
    email: 'a@example.com',
    profile: { userId: 'u1', dateOfBirth: null },
    privacy: {
      publicProfile: false,
      leaderboardOptIn: false,
      locationForLeaderboard: false,
      aiFeaturesConsent: false,
      aiFeaturesConsentAt: null,
      crashDiagnostics: false,
    },
  }),
  updatePrivacy: jest.fn(),
  updateProfile: jest.fn(),
  setDateOfBirth: jest.fn(),
  uploadAvatar: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

describe('date-of-birth gate (ADR-042)', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('sends a signed-in account with no date of birth to the Your Profile step', async () => {
    const rendered = renderApp({ initialUrl: '/profile' });
    const { findByText } = await rendered;

    await findByText('Your Profile');
    expect(rendered.getPathname()).toBe('/pick-username');
  });
});
