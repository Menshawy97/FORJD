// Slice 2, phase G. Split into its own file (one navigation assertion per file) because
// expo-router's testing-library keeps navigation state that outlives a single `it()` block —
// a second `renderRouter()` call within the same file did not reliably start back at
// `/profile`, so this and profile-navigation-units.test.tsx each get their own fresh module
// registry from Jest instead of sharing one.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  getMe: jest
    .fn()
    .mockResolvedValue({ id: 'u1', email: 'a@example.com', profile: null, privacy: null }),
  updateProfile: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

describe('profile tab navigation (slice 2) — editProfile', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('tapping the identity row opens editProfile', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('James Mitchell'));

    await findByText('Name');
    expect(rendered.getPathname()).toBe('/edit-profile');
  });
});
