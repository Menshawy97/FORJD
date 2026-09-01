// Part 1.1 RED: the swipe-back bug. `welcome.tsx` *pushes* to `/signup`, and signup's
// post-auth navigation used a bare `router.replace`, which swaps the top stack entry without
// ever clearing what is underneath it. `welcome` was permanently parked at stack index 0, so
// `react-native-screens`' interactive pop gesture (armed whenever stack depth > 1) always had
// something to pop to — the user stayed authenticated but landed on a
// sign-in-or-create-account screen, which reads as a sign-out.
//
// The fix is `router.canDismiss() && router.dismissAll()` immediately before the post-signup
// `replace`. ADR-019 changed that replace's target from `/goals?returnTo=newAccount` to
// `/pick-username` (see signup-submit.test.tsx), but the dismiss-then-replace mechanic under
// test here is unaffected either way. Asserts `router.canDismiss()` directly — the same check
// `react-native-screens` uses to decide whether the pop gesture has anywhere to go — rather
// than a pathname.
//
// Split from login's equivalent test (swipe-back-login.test.tsx) — see that file's header for
// why two full auth flows do not belong in one file here.
//
// Mocks `expo-secure-store` so the real save/notify plumbing runs, and `getMe` so the
// first-run `goals` screen (reached later, via pick-username's own Continue) can load, same
// as signup-submit.test.tsx.
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  signup: jest.fn(),
  getMe: jest.fn().mockResolvedValue({
    id: 'u1',
    email: 'new@example.com',
    profile: null,
    privacy: null,
  }),
}));

import * as SecureStore from 'expo-secure-store';
import { signup } from '@/auth/apiClient';

describe('swipe-back stack reset - signup', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('leaves nothing to pop to after signing up from a pushed signup screen', async () => {
    (signup as jest.Mock).mockResolvedValue({
      userId: 'u1',
      email: 'new@example.com',
      emailVerified: true,
      session: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const rendered = renderRouter('src/app', { initialUrl: '/welcome' });
    const { findByText, findByPlaceholderText } = await rendered;
    await findByText(/Training\./);

    await act(async () => router.push('/signup'));
    await findByText('Create account');

    fireEvent.changeText(await findByPlaceholderText('Your name'), 'Ada Lovelace');
    fireEvent.changeText(await findByPlaceholderText('you@email.com'), 'new@example.com');
    fireEvent.changeText(await findByPlaceholderText('Min. 8 characters'), 'Str0ng!Pass');
    fireEvent.press(await findByText('Create Account'));

    await findByText('Your Profile');

    expect(router.canDismiss()).toBe(false);
  });
});
