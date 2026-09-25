// Device report: saving a real InBody 120 scan failed with "check your connection" -- the server
// had rejected the 30.5 kg trunk against a 30 kg ceiling. Limits are now realistic, and the
// screen checks them before sending so an out-of-range value is named on its own row.
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BODY_METRICS, SEGMENTAL_SITES } from '@forjd/domain';

const mockReplace = jest.fn();

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn(), back: jest.fn() },
    useFocusEffect: (callback: () => void | (() => void)) => {
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({ confirmBodyScan: jest.fn() }));

import { confirmBodyScan } from '@/auth/apiClient';
import { setPendingScan } from '@/store/pending-scan';

import InBodyConfirmScreen from '../inbody-confirm';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

/** The real sheet's values, all read with high confidence. */
function pendingScan(overrides: Partial<Record<string, number>> = {}) {
  const values: Record<string, number> = {
    weight_kg: 87.6,
    skeletal_muscle_mass_kg: 37.3,
    body_fat_mass_kg: 21.9,
    body_fat_percent: 25,
    visceral_fat_level: 10,
    total_body_water_l: 48.1,
    bmi: 25.3,
    basal_metabolic_rate_kcal: 1788,
    inbody_score: 70,
    right_arm: 3.95,
    left_arm: 3.93,
    trunk: 30.5,
    right_leg: 10.18,
    left_leg: 10.11,
    ...overrides,
  };
  const field = (value: number) => ({ value, confidence: 0.99, readingNote: '' });
  setPendingScan({
    photoUri: 'file:///sheet.jpg',
    extracted: {
      inbodyModel: 'InBody120',
      testDate: '2025-08-02',
      fields: Object.fromEntries(BODY_METRICS.map((m) => [m, field(values[m]!)])) as never,
      segmental: Object.fromEntries(SEGMENTAL_SITES.map((s) => [s, field(values[s]!)])) as never,
      heightCm: { value: null, confidence: 0, readingNote: '' },
      ageYears: { value: null, confidence: 0, readingNote: '' },
      imageQualityNotes: '',
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (confirmBodyScan as jest.Mock).mockResolvedValue({ id: 'scan-1' });
});

describe('Confirm scan -- value limits', () => {
  it("saves the real sheet, including its 30.5 kg trunk", async () => {
    pendingScan();
    const { findByRole } = await render(<InBodyConfirmScreen />);

    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    expect(confirmBodyScan).toHaveBeenCalledTimes(1);
    const body = (confirmBodyScan as jest.Mock).mock.calls[0][1];
    expect(body.measurements).toContainEqual(expect.objectContaining({ metric: 'trunk', value: 30.5 }));
  });

  it('names an out-of-range value on its own row and sends nothing', async () => {
    pendingScan();
    const { findByRole, getByLabelText, findByText } = await render(<InBodyConfirmScreen />);

    await fireEvent.changeText(getByLabelText('Trunk'), '95');
    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    expect(await findByText('Must be between 0.5 and 90 kg')).toBeTruthy();
    expect(confirmBodyScan).not.toHaveBeenCalled();
  });
});
