// ADR-043. The explainer shown before FORJD collects any health data (Phase 8: "explicit consent
// screens before requesting HealthKit/Health Connect/WHOOP permissions, separate from generic
// app permissions"). Modelled on location.tsx -- the design's existing permission explainer --
// because the prototype has no consent screen of its own.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import { AxiosError } from 'axios';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) } }));

jest.mock('@/auth/apiClient', () => ({ updatePrivacy: jest.fn() }));

import { updatePrivacy } from '@/auth/apiClient';

import HealthConsentScreen from '../health-consent';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('HealthConsentScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (updatePrivacy as jest.Mock).mockResolvedValue({});
  });

  it('explains what is collected, who sees it, what declining means and how to undo it', async () => {
    const { findByText } = await render(<HealthConsentScreen />);

    await findByText('Use your health data?');
    await findByText('What is collected?');
    await findByText('Who sees it?');
    await findByText('What if you decline?');
    await findByText('Can you change your mind?');
    await findByText('Allow');
    await findByText('Not Now');
  });

  it('records consent and returns to the connect screen when allowed', async () => {
    const { findByText } = await render(<HealthConsentScreen />);

    fireEvent.press(await findByText('Allow'));

    await waitFor(() => expect(updatePrivacy).toHaveBeenCalledWith({ healthDataConsent: true }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/connect'));
  });

  it('records nothing and returns when the person says Not Now', async () => {
    const { findByText } = await render(<HealthConsentScreen />);

    fireEvent.press(await findByText('Not Now'));

    expect(updatePrivacy).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/connect');
  });

  it('stays on the screen and says so when consent could not be saved', async () => {
    (updatePrivacy as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));
    const { findByText } = await render(<HealthConsentScreen />);

    fireEvent.press(await findByText('Allow'));

    expect(await findByText('Cannot reach FORJD. Check your connection and try again.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
