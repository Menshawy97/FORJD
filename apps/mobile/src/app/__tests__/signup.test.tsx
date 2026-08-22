// Phase 5 RED: signup screen — the all-fields-required error state on empty submit, per
// 01-screen-inventory.md. The successful-submit case lives in its own file
// (signup-submit.test.tsx) — see login.test.tsx's header comment for why (secureStorage's
// in-memory cache is a module-level singleton; file boundaries are Jest's real isolation
// unit, not describe/it boundaries).
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  signup: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { signup } from '@/auth/apiClient';

describe('signup screen - validation', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it('shows the all-fields-required error on empty submit', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/signup' });

    fireEvent.press(await findByText('Create Account'));

    await findByText('All fields are required.');
    expect(signup).not.toHaveBeenCalled();
  });
});
