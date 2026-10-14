// Emulator walk finding 12: a run notice left in the status bar by an app closed mid-run is taken down when the app
// starts, signed in or not (`dismissStaleRunNotice`, covered in features/run/__tests__/run-notification.test.ts).
import { waitFor } from '@testing-library/react-native';
import { renderApp } from './render-app';

jest.mock('expo-secure-store');
jest.mock('@/features/run/run-notification', () => ({
  ...jest.requireActual('@/features/run/run-notification'),
  dismissStaleRunNotice: jest.fn().mockResolvedValue(undefined),
}));

import * as SecureStore from 'expo-secure-store';
import { dismissStaleRunNotice } from '@/features/run/run-notification';

describe('a leftover run notice at app start', () => {
  it('is taken down once when the app starts', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

    await renderApp({ initialUrl: '/welcome' });

    await waitFor(() => expect(dismissStaleRunNotice).toHaveBeenCalledTimes(1));
  });
});
