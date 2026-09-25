// scan-height-age-plan.md §4.5 (designs approved 2026-09-25): Profile's Training group carries
// Activity level and Body goal, each showing the saved choice and opening its page. A separate file
// for the same reason as profile-navigation-goals.test.tsx.
import { fireEvent } from '@testing-library/react-native';
import { renderApp } from './render-app';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn().mockResolvedValue({
    id: 'u1',
    email: 'a@example.com',
    profile: {
      displayName: 'Omar',
      username: 'omarh',
      city: null,
      trainingGoals: [],
      activities: [],
      unitSystem: 'metric',
      weightUnit: 'kg',
      activityLevel: 'active',
      bodyGoal: 'lose_fat',
    },
    privacy: null,
  }),
  updateProfile: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

describe('profile tab navigation — activity level and body goal', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('shows the saved choices, and opens the body goal page', async () => {
    const rendered = renderApp({ initialUrl: '/profile' });
    const { findByText } = await rendered;

    expect(await findByText('Active · × 1.7')).toBeTruthy();
    expect(await findByText('Lose fat · 15% under maintenance')).toBeTruthy();
    fireEvent.press(await findByText('Body goal'));

    await findByText('Whether your suggested calories sit below, at, or above maintenance.');
    expect(rendered.getPathname()).toBe('/body-goal');
  });
});
