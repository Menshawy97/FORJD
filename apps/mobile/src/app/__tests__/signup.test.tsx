// Phase 5 RED: signup screen — the all-fields-required error state on empty submit, per
// 01-screen-inventory.md. The successful-submit case lives in its own file
// (signup-submit.test.tsx) — see login.test.tsx's header comment for why (secureStorage's
// in-memory cache is a module-level singleton; file boundaries are Jest's real isolation
// unit, not describe/it boundaries).
import { fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { renderApp } from './render-app';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  signup: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { signup } from '@/auth/apiClient';

// The consent line under the buttons names the Privacy Policy; the words open the policy on the website. Looks unchanged (design).
describe('signup screen - privacy policy link', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens the privacy policy when "Privacy Policy" in the consent line is tapped', async () => {
    const { findByText } = await renderApp({ initialUrl: '/signup' });

    fireEvent.press(await findByText('Privacy Policy'));

    expect(Linking.openURL).toHaveBeenCalledWith('https://getforjd.com/privacy');
  });

  it('opens the terms of use when "Terms of Service" in the consent line is tapped', async () => {
    const { findByText } = await renderApp({ initialUrl: '/signup' });

    fireEvent.press(await findByText('Terms of Service'));

    expect(Linking.openURL).toHaveBeenCalledWith('https://getforjd.com/terms');
  });

  it('keeps the whole consent sentence', async () => {
    const { findByText } = await renderApp({ initialUrl: '/signup' });

    await findByText(/By creating an account you agree to our Terms of Service and/);
  });
});

describe('signup screen - validation', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it('shows the all-fields-required error on empty submit', async () => {
    const { findByText } = await renderApp({ initialUrl: '/signup' });

    fireEvent.press(await findByText('Create Account'));

    await findByText('All fields are required.');
    expect(signup).not.toHaveBeenCalled();
  });
});
