// R26 -- a failed `getBodyScan` pair used to be swallowed to `null`/`null`, rendering the same
// header-only screen the missing-params case shows: no error text, no retry, and the two states
// were indistinguishable. This pins the fix: a failed load renders text distinct from that
// empty state, with a retry control that re-issues both requests.
//
// NOTE: @testing-library/react-native v14 -- render() and every fireEvent.* return Promises
// and must be awaited.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({ a: 'scan-a', b: 'scan-b' }));

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { back: (...args: unknown[]) => mockBack(...args) },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (callback: () => void | (() => void)) => {
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  getBodyScan: jest.fn(),
}));

import { getBodyScan } from '@/auth/apiClient';

import InBodyCompareScreen from '../inbody-compare';

const mockGetBodyScan = getBodyScan as jest.MockedFunction<typeof getBodyScan>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const scanA = {
  id: 'scan-a',
  measuredAt: '2026-07-20T08:00:00.000Z',
  source: 'inbody' as const,
  measurements: [{ metric: 'weight_kg' as const, value: 80, unit: 'kg', confidence: 0.97 }],
};
const scanB = {
  id: 'scan-b',
  measuredAt: '2026-08-20T08:00:00.000Z',
  source: 'inbody' as const,
  measurements: [{ metric: 'weight_kg' as const, value: 84.6, unit: 'kg', confidence: 0.97 }],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('InBodyCompareScreen error state (R26)', () => {
  it('renders the comparison when the load succeeds', async () => {
    mockGetBodyScan.mockImplementation((id: string) => Promise.resolve(id === 'scan-a' ? scanA : scanB));

    const screen = await render(<InBodyCompareScreen />);

    expect(await screen.findByText('80 kg')).toBeTruthy();
  });

  it('renders a distinct error state, not the header-only empty view, when the load fails', async () => {
    mockGetBodyScan.mockRejectedValue(new Error('boom'));

    const screen = await render(<InBodyCompareScreen />);

    expect(await screen.findByText('Could not load these scans. Please try again.')).toBeTruthy();
    expect(screen.getByLabelText('Retry')).toBeTruthy();
  });

  it('tapping retry re-issues both requests', async () => {
    mockGetBodyScan
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((id: string) => Promise.resolve(id === 'scan-a' ? scanA : scanB));

    const screen = await render(<InBodyCompareScreen />);
    const retryButton = await screen.findByLabelText('Retry');

    expect(mockGetBodyScan).toHaveBeenCalledTimes(2);

    await fireEvent.press(retryButton);

    await waitFor(() => expect(mockGetBodyScan).toHaveBeenCalledTimes(4));
    expect(await screen.findByText('80 kg')).toBeTruthy();
    expect(screen.queryByText('Could not load these scans. Please try again.')).toBeNull();
  });
});
