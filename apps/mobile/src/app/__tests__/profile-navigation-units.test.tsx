// Slice 2, phase G. See profile-navigation-edit-profile.test.tsx's header for why this is a
// separate file rather than a second `it()` alongside it.
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

describe('profile tab navigation (slice 2) — units', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('tapping "Units & Preferences" opens units', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Units & Preferences'));

    await findByText('Save Changes');
    expect(rendered.getPathname()).toBe('/units');
  });
});
