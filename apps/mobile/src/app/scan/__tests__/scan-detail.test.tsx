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
  heightCm: null,
  ageYears: null,
  measurements: [{ metric: 'weight_kg' as const, value: 84.6, unit: 'kg', confidence: 0.97, calculated: false }],
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

// Slice E (scan-height-age-plan.md §4.1–4.3): a value the app worked out says so, and why.
describe('ScanDetailScreen: calculated values', () => {
  const m = (metric: string, value: number, unit: string, calculated: boolean) => ({
    metric: metric as 'weight_kg',
    value,
    unit,
    confidence: 1,
    calculated,
  });
  const withMeasurements = (source: 'inbody' | 'manual', measurements: ReturnType<typeof m>[]) => ({
    ...scan,
    source,
    heightCm: 178,
    ageYears: 31,
    measurements,
  });

  it('tags a calculated BMI and says what it came from', async () => {
    mockGetBodyScan.mockResolvedValue(
      withMeasurements('inbody', [m('weight_kg', 86.6, 'kg', false), m('bmi', 27.3, '', true)]),
    );
    const { findByText, getAllByText } = await render(<ScanDetailScreen />);

    expect(await findByText('Not on the sheet: from weight and height')).toBeTruthy();
    expect(getAllByText('Calculated')).toHaveLength(1);
  });

  it("says 'not entered' on a manual entry, and explains a calculated BMR", async () => {
    mockGetBodyScan.mockResolvedValue(
      withMeasurements('manual', [m('weight_kg', 86.6, 'kg', false), m('basal_metabolic_rate_kcal', 1949, 'kcal', true)]),
    );
    const { findByText } = await render(<ScanDetailScreen />);

    expect(await findByText('Not entered: from fat-free mass')).toBeTruthy();
  });

  it('shows the fat-free mass index with its height-adjusted value', async () => {
    mockGetBodyScan.mockResolvedValue(
      withMeasurements('inbody', [m('weight_kg', 86.6, 'kg', false), m('fat_free_mass_index', 23.1, '', true)]),
    );
    const { findByText, getByText } = await render(<ScanDetailScreen />);

    expect(await findByText('Fat-free mass index')).toBeTruthy();
    expect(getByText('From weight, body fat and height · height-adjusted 23.2')).toBeTruthy();
  });

  it('shows a sheet-printed FFMI untagged, still with its height-adjusted value', async () => {
    mockGetBodyScan.mockResolvedValue(
      withMeasurements('inbody', [m('weight_kg', 86.6, 'kg', false), m('fat_free_mass_index', 23.1, '', false)]),
    );
    const { findByText, queryByText } = await render(<ScanDetailScreen />);

    expect(await findByText('Height-adjusted 23.2')).toBeTruthy();
    expect(queryByText('Calculated')).toBeNull();
  });
});
