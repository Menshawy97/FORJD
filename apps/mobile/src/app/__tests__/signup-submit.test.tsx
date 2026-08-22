// Phase 5 RED: signup screen — successful submit calls signup() once, persists the
// session, and lands on the tabs. Split from signup.test.tsx; see that file's header for why.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  signup: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { signup } from '@/auth/apiClient';

describe('signup screen - successful submit', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('calls signup() exactly once with the entered values, persists the session, and lands on the tabs', async () => {
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

    await findByText('home — coming soon');

    expect(signup).toHaveBeenCalledTimes(1);
    expect(signup).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'Str0ng!Pass',
      displayName: 'Ada Lovelace',
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forjd.accessToken', 'access-1');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('forjd.refreshToken', 'refresh-1');
    expect(rendered.getPathname()).toBe('/');
  });
});
