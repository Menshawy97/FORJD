// Phase 5 RED: login screen success — submit calls login() once, persists the session, and
// lands on the tabs. Per 01-screen-inventory.md.
//
// The wrong-credentials case lives in its own file (login-error.test.tsx): secureStorage's
// in-memory token cache is a module-level singleton that (correctly, in production) is not
// reset between renders in the same process — so a session saved by this file's test would
// leak into a second test in the same file. Jest gives each test *file* a fresh module
// registry, which is the isolation boundary that actually works here (see
// welcome.test.tsx / welcome-login-cta.test.tsx for the identical reasoning applied to the
// expo-router route store).
//
// Mocks `expo-secure-store` (the true native dependency) rather than `@/auth/secureStorage`
// itself, so the real secureStorage save/notify plumbing runs — that's what lets the root
// layout's `useSyncExternalStore`-driven AuthGate react to a successful login within the
// same render pass. A hand-rolled no-op `subscribeToSession` mock breaks that reactivity.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
// Home is a real dashboard now, not a placeholder, and it loads on focus -- so landing on
// the tabs after a successful login exercises its three requests. They are stubbed here so
// this test stays about login, not about what Home shows.
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

describe('login screen - success', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('calls login() exactly once with the entered values, persists the session, and lands on the tabs', async () => {
    (login as jest.Mock).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });

    const rendered = renderRouter('src/app', { initialUrl: '/login' });
    const { findByText, findByPlaceholderText } = await rendered;

    fireEvent.changeText(
      await findByPlaceholderText('james.mitchell@example.com'),
      'user@example.com',
    );
    fireEvent.changeText(await findByPlaceholderText('••••••••'), 'Str0ng!Pass');

    fireEvent.press(await findByText('Log In'));

    // Home's wordmark: the marker that the tabs shell has taken over. It replaced
    // 'home — coming soon' when Home stopped being a placeholder screen.
    await findByText('FORJD');

    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith({ email: 'user@example.com', password: 'Str0ng!Pass' });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forjd.accessToken', 'access-1');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forjd.refreshToken', 'refresh-1');
    expect(rendered.getPathname()).toBe('/');
  });
});
