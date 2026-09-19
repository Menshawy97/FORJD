// Phase 7G. Only the WHOOP card is real; Apple Health/Health Connect are deliberately inert
// (see connect.tsx's own header comment for why).
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: {
      replace: (...args: unknown[]) => mockReplace(...args),
      push: (...args: unknown[]) => mockPush(...args),
    },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

jest.mock('@/auth/apiClient', () => ({
  getWhoopStatus: jest.fn(),
  connectWhoop: jest.fn(),
  disconnectWhoop: jest.fn(),
}));

import * as WebBrowser from 'expo-web-browser';
import { AxiosError } from 'axios';
import { connectWhoop, disconnectWhoop, getWhoopStatus } from '@/auth/apiClient';

import ConnectScreen from '../connect';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('ConnectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows WHOOP as Connect and the other two sources as inert when disconnected', async () => {
    (getWhoopStatus as jest.Mock).mockResolvedValue({ connected: false, lastSyncAt: null });
    const { findByText, getAllByText, queryByText } = await render(<ConnectScreen />);

    await findByText('Connect');
    expect(queryByText('Disconnect')).toBeNull();
    // Apple Health and Health Connect never render an action pill at all.
    expect(getAllByText('Coming soon')).toHaveLength(2);
  });

  it('shows WHOOP as Disconnect when already connected', async () => {
    (getWhoopStatus as jest.Mock).mockResolvedValue({ connected: true, lastSyncAt: '2026-09-08T06:00:00.000Z' });
    const { findByText, queryByText } = await render(<ConnectScreen />);

    await findByText('Disconnect');
    expect(queryByText('Connect')).toBeNull();
  });

  it('tapping Connect opens the WHOOP authorize URL and refetches status once the browser closes', async () => {
    (getWhoopStatus as jest.Mock)
      .mockResolvedValueOnce({ connected: false, lastSyncAt: null })
      .mockResolvedValueOnce({ connected: true, lastSyncAt: null });
    (connectWhoop as jest.Mock).mockResolvedValue({ authorizeUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth' });
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({ type: 'success', url: 'forjd://whoop-callback?status=success' });

    const { findByText } = await render(<ConnectScreen />);
    fireEvent.press(await findByText('Connect'));

    await waitFor(() => expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://api.prod.whoop.com/oauth/oauth2/auth',
      'forjd://whoop-callback',
    ));
    await findByText('Disconnect');
    expect(getWhoopStatus).toHaveBeenCalledTimes(2);
  });

  // ADR-043: the server refuses to start WHOOP without health-data consent. The app answers by
  // taking the person to the explainer where they can give it -- not by showing an error.
  it('sends the person to the health data consent screen when the server asks for it', async () => {
    (getWhoopStatus as jest.Mock).mockResolvedValue({ connected: false, lastSyncAt: null });
    (connectWhoop as jest.Mock).mockRejectedValue(
      new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
        data: { code: 'health_data_consent_required' },
      } as never),
    );

    const { findByText } = await render(<ConnectScreen />);
    fireEvent.press(await findByText('Connect'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/health-consent'));
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('tapping Disconnect calls the real endpoint and flips the card back to Connect', async () => {
    (getWhoopStatus as jest.Mock).mockResolvedValue({ connected: true, lastSyncAt: null });
    (disconnectWhoop as jest.Mock).mockResolvedValue(undefined);

    const { findByText } = await render(<ConnectScreen />);
    fireEvent.press(await findByText('Disconnect'));

    await waitFor(() => expect(disconnectWhoop).toHaveBeenCalled());
    await findByText('Connect');
  });

  it('tapping Save navigates back to profile', async () => {
    (getWhoopStatus as jest.Mock).mockResolvedValue({ connected: false, lastSyncAt: null });
    const { findByText } = await render(<ConnectScreen />);
    await findByText('Connect your data');

    fireEvent.press(await findByText('Save'));

    expect(mockReplace).toHaveBeenCalledWith('/profile');
  });
});
