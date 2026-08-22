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
jest.mock('@/auth/apiClient', () => ({
  login: jest.fn(),
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

    await findByText('home — coming soon');

    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith({ email: 'user@example.com', password: 'Str0ng!Pass' });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forjd.accessToken', 'access-1');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forjd.refreshToken', 'refresh-1');
    expect(rendered.getPathname()).toBe('/');
  });
});
