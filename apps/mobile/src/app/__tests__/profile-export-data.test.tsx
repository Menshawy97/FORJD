// R4 (H2) -- GDPR Art. 15 & 20. The "Export my data" row on the profile/Settings screen calls
// through to `shareAccountExport`, which hits `GET /users/me/export` and hands the resulting
// file to the OS share sheet. This test mocks that module the same way
// `profile-navigation-connect.test.tsx` mocks `@/auth/apiClient` -- one navigation/behavior
// assertion per file, matching this directory's own convention.
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('@/auth/apiClient', () => ({
  getMe: jest
    .fn()
    .mockResolvedValue({ id: 'u1', email: 'a@example.com', profile: null, privacy: null }),
  updateProfile: jest.fn(),
  updatePrivacy: jest.fn(),
  getWhoopStatus: jest.fn().mockResolvedValue({ connected: false, lastSyncAt: null }),
  connectWhoop: jest.fn(),
  disconnectWhoop: jest.fn(),
}));
jest.mock('@/data-export/share-account-export', () => ({
  shareAccountExport: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

import { shareAccountExport } from '@/data-export/share-account-export';

describe('profile tab (R4) — export my data', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    (shareAccountExport as jest.Mock).mockResolvedValue(undefined);
  });

  it(
    'renders an Export my data row under Account',
    async () => {
      const rendered = renderRouter('src/app', { initialUrl: '/profile' });
      const { findByText } = await rendered;

      expect(await findByText('Export my data')).toBeTruthy();
    },
    60000,
  );

  it('tapping Export my data calls the export/share flow and stays on the profile screen', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Export my data'));

    await waitFor(() => expect(shareAccountExport).toHaveBeenCalledTimes(1));
    expect(rendered.getPathname()).toBe('/profile');
  });

  it('shows an error and re-enables the row when the export fails', async () => {
    (shareAccountExport as jest.Mock).mockRejectedValue(new Error('network error'));
    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Export my data'));

    expect(await findByText(/could not export/i)).toBeTruthy();
    expect(await findByText('Download a copy of everything we store')).toBeTruthy();
  });
});
