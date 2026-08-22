// Phase 5 RED: login screen — wrong credentials render an error state without navigating
// away. Split from login.test.tsx; see that file's header comment for why.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  login: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { login } from '@/auth/apiClient';

describe('login screen - wrong credentials', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('shows an error state on wrong credentials and does not navigate away', async () => {
    (login as jest.Mock).mockRejectedValue({
      response: { status: 401, data: { message: 'Invalid credentials' } },
    });

    const rendered = renderRouter('src/app', { initialUrl: '/login' });
    const { findByText, findByPlaceholderText } = await rendered;

    fireEvent.changeText(
      await findByPlaceholderText('james.mitchell@example.com'),
      'user@example.com',
    );
    fireEvent.changeText(await findByPlaceholderText('••••••••'), 'WrongPass1!');

    fireEvent.press(await findByText('Log In'));

    await findByText(/incorrect|invalid/i);

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(rendered.getPathname()).toBe('/login');
  });
});
