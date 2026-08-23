// Phase 5 RED: signup screen — successful submit calls signup() once, persists the
// session, and lands on the tabs. Split from signup.test.tsx; see that file's header for why.
//
// Phase H: the destination changed from `/` straight to `/goals?returnTo=newAccount` — the
// prototype's first-run path always visits goals before home (§4.6/§4.8 of
// slice2-screen-specs.md). See profile-navigation-goals.test.tsx and goals.test.tsx for the
// screen this now lands on.
import { fireEvent } from '@testing-library/react-native';
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

describe('signup screen - successful submit', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('calls signup() exactly once with the entered values, persists the session, and lands on goals as a first-run', async () => {
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

    const rendered = renderRouter('src/app', { initialUrl: '/signup' });
    const { findByText, findByPlaceholderText } = await rendered;

    fireEvent.changeText(await findByPlaceholderText('Your name'), 'Ada Lovelace');
    fireEvent.changeText(await findByPlaceholderText('you@email.com'), 'new@example.com');
    fireEvent.changeText(await findByPlaceholderText('Min. 8 characters'), 'Str0ng!Pass');

    fireEvent.press(await findByText('Create Account'));

    await findByText('What are you training for?');

    expect(signup).toHaveBeenCalledTimes(1);
    expect(signup).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'Str0ng!Pass',
      displayName: 'Ada Lovelace',
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forjd.accessToken', 'access-1');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forjd.refreshToken', 'refresh-1');
    expect(rendered.getPathname()).toBe('/goals');
    expect(rendered.getSearchParams()).toMatchObject({ returnTo: 'newAccount' });
  });
});
