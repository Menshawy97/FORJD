// ADR-052: while an InBody photo is being read -- the app's longest wait, several seconds
// of server-side extraction -- the drop zone shows animation #3, the pulsing FORJD symbol.
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), setParams: jest.fn() },
    useLocalSearchParams: () => mockSearchParams,
    useFocusEffect: (callback: () => void | (() => void)) => {
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('@/auth/apiClient', () => ({
  extractBodyScan: jest.fn(),
  listBodyScans: jest.fn(),
}));

import { AxiosError, AxiosHeaders } from 'axios';
import * as ImagePicker from 'expo-image-picker';

import { extractBodyScan, listBodyScans } from '@/auth/apiClient';

import InBodyScreen from '../inbody';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('InBody photo extraction', () => {
  it('shows the logo loader while the photo is being read', async () => {
    (listBodyScans as jest.Mock).mockResolvedValue({ scans: [] });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///sheet.jpg' }],
    });
    // Settled by the test itself: the press handler awaits the extraction, and RNTL's async
    // fireEvent waits on it, so a promise that never settles would hang the test.
    let finishExtraction: (value: unknown) => void = () => {};
    (extractBodyScan as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finishExtraction = resolve;
      }),
    );

    const { findByText, findByLabelText, queryByText } = await render(<InBodyScreen />);
    const pressed = fireEvent.press(await findByText('Choose from library instead'));

    expect(await findByLabelText('Loading')).toBeTruthy();
    expect(queryByText('Take photo or upload')).toBeNull();

    finishExtraction({});
    await pressed;
  });
});

/** The API's refusal when the account has not turned on AI insights (body.service.ts). */
function consentRefusal(): AxiosError {
  return new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 403,
    statusText: 'Forbidden',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {
      statusCode: 403,
      error: 'Forbidden',
      message: 'AI features consent is required to process a body scan photo',
    },
  });
}

describe('InBody photo extraction refused', () => {
  beforeEach(() => {
    mockPush.mockClear();
    (listBodyScans as jest.Mock).mockResolvedValue({ scans: [] });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///sheet.jpg' }],
    });
  });

  // Device feedback: with AI insights off, the server refuses the photo (403) and the app said
  // "try again with better lighting" -- blaming the photo for a setting.
  it('explains that AI insights must be on, and opens Privacy from a button', async () => {
    (extractBodyScan as jest.Mock).mockRejectedValue(consentRefusal());

    const { findByText, findByRole, queryByText } = await render(<InBodyScreen />);
    await fireEvent.press(await findByText('Choose from library instead'));

    expect(await findByText(/Turn on AI insights in Privacy to continue/)).toBeTruthy();
    expect(queryByText(/better lighting/)).toBeNull();

    await fireEvent.press(await findByRole('button', { name: 'Open Privacy settings' }));
    expect(mockPush).toHaveBeenCalledWith('/privacy');
  });

  it('keeps the photo-quality message for any other failure', async () => {
    (extractBodyScan as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const { findByText, queryByText } = await render(<InBodyScreen />);
    await fireEvent.press(await findByText('Choose from library instead'));

    expect(await findByText(/better lighting/)).toBeTruthy();
    expect(queryByText(/Turn on AI insights/)).toBeNull();
  });
});

describe('manual entry on the InBody screen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSearchParams = {};
    (listBodyScans as jest.Mock).mockResolvedValue({
      scans: [
        { id: '11111111-1111-1111-1111-111111111111', measuredAt: '2026-09-24T09:15:00.000Z', source: 'manual', weightKg: 82.4, bodyFatPercent: 12.1 },
        { id: '22222222-2222-2222-2222-222222222222', measuredAt: '2026-08-11T09:15:00.000Z', source: 'inbody', weightKg: 87.1, bodyFatPercent: 16.4 },
      ],
    });
  });

  it('offers "Enter values manually", which opens the form', async () => {
    const { findByRole } = await render(<InBodyScreen />);

    await fireEvent.press(await findByRole('button', { name: /Enter values manually/ }));

    expect(mockPush).toHaveBeenCalledWith('/inbody-manual');
  });

  it('tags a manual entry in the history, and only that one', async () => {
    const { findAllByText, findByText } = await render(<InBodyScreen />);

    await findByText('87.1 kg · 16.4%');
    expect(await findAllByText('Manual')).toHaveLength(1);
  });

  it('confirms a manual save when it lands back here', async () => {
    mockSearchParams = { saved: 'manual' };
    const { findByText } = await render(<InBodyScreen />);

    expect(await findByText('Values saved to history')).toBeTruthy();
  });
});
