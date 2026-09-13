// R26 -- a failed `getBodyScan` used to be swallowed to `null`, rendering the same empty
// scroll view a scan with zero measurements would show: no error text, no retry, and the two
// states were indistinguishable. This pins the fix: a failed load renders text distinct from
// the empty state, with a retry control that re-issues the request.
//
// NOTE: @testing-library/react-native v14 -- render() and every fireEvent.* return Promises
// and must be awaited.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({ id: 'scan-1' }));

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

import ScanDetailScreen from '../[id]';

const mockGetBodyScan = getBodyScan as jest.MockedFunction<typeof getBodyScan>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const scan = {
  id: 'scan-1',
  measuredAt: '2026-08-20T08:00:00.000Z',
  source: 'inbody' as const,
  measurements: [{ metric: 'weight_kg' as const, value: 84.6, unit: 'kg', confidence: 0.97 }],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ScanDetailScreen error state (R26)', () => {
  it('renders the measurements when the load succeeds', async () => {
    mockGetBodyScan.mockResolvedValue(scan);

    const screen = await render(<ScanDetailScreen />);

    expect(await screen.findByText('84.6 kg')).toBeTruthy();
  });

  it('renders a distinct error state, not the empty scroll view, when the load fails', async () => {
    mockGetBodyScan.mockRejectedValue(new Error('boom'));

    const screen = await render(<ScanDetailScreen />);

    expect(await screen.findByText('Could not load this scan. Please try again.')).toBeTruthy();
    expect(screen.getByLabelText('Retry')).toBeTruthy();
  });

  it('tapping retry re-issues the request', async () => {
    mockGetBodyScan.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(scan);

    const screen = await render(<ScanDetailScreen />);
    const retryButton = await screen.findByLabelText('Retry');

    expect(mockGetBodyScan).toHaveBeenCalledTimes(1);

    await fireEvent.press(retryButton);

    await waitFor(() => expect(mockGetBodyScan).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('84.6 kg')).toBeTruthy();
    expect(screen.queryByText('Could not load this scan. Please try again.')).toBeNull();
  });
});
