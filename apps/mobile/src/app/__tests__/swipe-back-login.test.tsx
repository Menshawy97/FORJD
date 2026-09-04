// Part 1.1 RED: the swipe-back bug. `welcome.tsx` *pushes* to `/login`, and login's post-auth
// navigation used a bare `router.replace`, which swaps the top stack entry without ever
// clearing what is underneath it. `welcome` was permanently parked at stack index 0, so
// `react-native-screens`' interactive pop gesture (armed whenever stack depth > 1) always had
// something to pop to — the user stayed authenticated but landed on a
// sign-in-or-create-account screen, which reads as a sign-out.
//
// The fix is `router.canDismiss() && router.dismissAll()` immediately before the post-login
// `replace`. This asserts the actual mechanism the gesture depends on — `router.canDismiss()`
// — rather than a specific pathname, since `canDismiss()` is exactly the check
// `react-native-screens` uses to decide whether the pop gesture has anywhere to go.
//
// Split from signup's equivalent test (swipe-back-signup.test.tsx): expo-router's testing
// library keeps navigation/route state across `it()` blocks in the same file (documented at
// the top of profile-navigation-edit-profile.test.tsx), so two full auth flows in one file do
// not reliably start from a clean stack.
//
// Mocks `expo-secure-store` rather than `@/auth/secureStorage` so the real save/notify
// plumbing runs, same reasoning as login.test.tsx.
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
// Home is a real dashboard now, not a placeholder, and it loads on focus -- so landing on
// the tabs after a successful login exercises its three requests. They are stubbed here so
// this test stays about the navigation stack, not about what Home shows.
jest.mock('@/auth/apiClient', () => ({
  // Phase 3K5: Home's Start Workout and Train's programs sections both read this.
  getProgramEnrollment: jest.fn().mockResolvedValue({ enrollment: null }),
  listPrograms: jest.fn().mockResolvedValue({ items: [] }),
  login: jest.fn(),
  getMe: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', profile: null, privacy: {} }),
  listNutritionLog: jest.fn().mockResolvedValue({ items: [] }),
  getMacroGoals: jest.fn().mockResolvedValue(null),
  // These suites land on Home after logging in, and Home reads workout stats (Phase 3J-c).
  // Resolved empty rather than omitted: an absent mock is not a rejected promise but a
  // `TypeError` thrown before `Promise.allSettled` is even called, which no amount of
  // settling can absorb.
  getWorkoutStats: jest.fn().mockResolvedValue({
    totalSessions: 0,
    sessionsThisMonth: 0,
    weekStreak: 0,
    thisWeek: { sessionCount: 0, trainedWeekdays: [] },
    recentPersonalRecord: null,
  }),
}));

import * as SecureStore from 'expo-secure-store';
import { login } from '@/auth/apiClient';

describe('swipe-back stack reset - login', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('leaves nothing to pop to after logging in from a pushed login screen', async () => {
    (login as jest.Mock).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });

    const rendered = renderRouter('src/app', { initialUrl: '/welcome' });
    const { findByText, findByPlaceholderText } = await rendered;
    await findByText(/Training\./);

    await act(async () => router.push('/login'));
    await findByText('Welcome back');

    fireEvent.changeText(
      await findByPlaceholderText('james.mitchell@example.com'),
      'user@example.com',
    );
    fireEvent.changeText(await findByPlaceholderText('••••••••'), 'Str0ng!Pass');
    fireEvent.press(await findByText('Log In'));

    // Home's wordmark: the marker that the tabs shell has taken over. It replaced
    // 'home — coming soon' when Home stopped being a placeholder screen.
    await findByText('FORJD');

    expect(router.canDismiss()).toBe(false);
  });
});
