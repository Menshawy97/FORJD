// RED first: a sign-up that comes back with no session (email confirmation required) must
// land on the "Check your email" screen, not carry on to "Your Profile".
//
// It must also drop whatever login the phone already held. Before this, a stale session from an
// earlier account stayed in the store, the app treated the new sign-up as signed in, and the
// first refused request threw the person back to welcome with "Your session expired".
import { fireEvent } from '@testing-library/react-native';
import { renderApp } from './render-app';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  signup: jest.fn(),
  getMe: jest.fn().mockResolvedValue({ id: 'u1', email: 'x@example.com', profile: null, privacy: null }),
}));

import * as SecureStore from 'expo-secure-store';
import { signup } from '@/auth/apiClient';
import { consumeSessionExpired } from '@/auth/secureStorage';

describe('signup screen - no session returned', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    (signup as jest.Mock).mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'new@example.com',
      emailVerified: false,
      session: null,
    });
  });

  async function submit() {
    const rendered = renderApp({ initialUrl: '/signup' });
    const utils = await rendered;
    fireEvent.changeText(await utils.findByPlaceholderText('Your name'), 'Ada Lovelace');
    fireEvent.changeText(await utils.findByPlaceholderText('you@email.com'), 'new@example.com');
    fireEvent.changeText(await utils.findByPlaceholderText('Min. 8 characters'), 'Str0ng!Pass');
    fireEvent.press(await utils.findByText('Create Account'));
    return { rendered, ...utils };
  }

  it('shows "Check your email" with the typed address and does not go to Your Profile', async () => {
    const { rendered, findByText, queryByText } = await submit();

    await findByText('Check your email');
    await findByText('new@example.com');
    expect(rendered.getPathname()).toBe('/check-email');
    expect(queryByText('Your Profile')).toBeNull();
  });

  it('stores no session', async () => {
    const { findByText } = await submit();
    await findByText('Check your email');

    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith('forjd.accessToken', expect.anything());
  });

  it('drops any login left from an earlier account and never shows the expired banner', async () => {
    const { findByText } = await submit();
    await findByText('Check your email');

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('forjd.accessToken');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('forjd.refreshToken');
    // A cleared-on-purpose session is not an expiry: the flag stays unset for welcome.
    expect(consumeSessionExpired()).toBe(false);
  });
});
