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
jest.mock('@/auth/apiClient', () => ({
  login: jest.fn(),
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

    await findByText('home — coming soon');

    expect(router.canDismiss()).toBe(false);
  });
});
