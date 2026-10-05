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

jest.mock('@/auth/apiClient', () => ({ confirmBodyScan: jest.fn(), getMe: jest.fn() }));

jest.mock('@/features/notifications/use-local-notifications', () => ({
  requestLocalNotificationReconcile: jest.fn(),
}));

import { confirmBodyScan, getMe } from '@/auth/apiClient';
import { requestLocalNotificationReconcile } from '@/features/notifications/use-local-notifications';
import { setPendingScan, takePendingScan } from '@/store/pending-scan';

import InBodyConfirmScreen from '../inbody-confirm';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

/** The real sheet's values, all read with high confidence. */
type Reading = { value: number | null; confidence: number; readingNote: string };
const noReading: Reading = { value: null, confidence: 0, readingNote: '' };

function pendingScan(
  overrides: Partial<Record<string, number>> = {},
  profile: { heightCm?: Reading; ageYears?: Reading } = {},
) {
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
      heightCm: profile.heightCm ?? { value: 177.8, confidence: 0.96, readingNote: 'Converted from 5 ft 10 in.' },
      ageYears: profile.ageYears ?? noReading,
      imageQualityNotes: '',
    },
  });
}

/** The signed-in person's profile: 175 cm, born 1994-03-12 -- 31 on the sheet's 2025-08-02 test date. */
function signedIn(profile: { heightCm: number | null; dateOfBirth: string | null } = { heightCm: 175, dateOfBirth: '1994-03-12' }) {
  (getMe as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'a@b.c', profile, privacy: {} });
}

beforeEach(() => {
  jest.clearAllMocks();
  (confirmBodyScan as jest.Mock).mockResolvedValue({ id: 'scan-1' });
  signedIn();
});

describe('Confirm scan -- value limits', () => {
  it("saves the real sheet, including its 30.5 kg trunk", async () => {
    pendingScan();
    const { findByRole } = await render(<InBodyConfirmScreen />);

    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    expect(confirmBodyScan).toHaveBeenCalledTimes(1);
    const body = (confirmBodyScan as jest.Mock).mock.calls[0][1];
    expect(body.measurements).toContainEqual(expect.objectContaining({ metric: 'trunk', value: 30.5 }));
    // A new scan moves the monthly check-in's start, so the schedule is planned again (12E).
    expect(requestLocalNotificationReconcile).toHaveBeenCalled();
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

/**
 * Height and age (docs/product/scan-height-age-plan.md §3, replica approved 2026-09-25): two
 * required rows at the top of the values. The sheet's reading wins; a value the sheet does not
 * print comes from the profile, amber until checked.
 */
describe('Confirm scan -- height and age', () => {
  it("shows the sheet's height with its confidence, and fills the missing age from the profile", async () => {
    pendingScan();
    const { findByLabelText, getByText } = await render(<InBodyConfirmScreen />);

    expect((await findByLabelText('Height')).props.value).toBe('177.8');
    expect((await findByLabelText('Age')).props.value).toBe('31');
    expect(getByText('96% confidence')).toBeTruthy();
    expect(getByText('Not on the sheet: from your profile. Please check.')).toBeTruthy();
  });

  it('saves both with the scan', async () => {
    pendingScan();
    const { findByRole, findByLabelText } = await render(<InBodyConfirmScreen />);
    await findByLabelText('Age');

    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    const body = (confirmBodyScan as jest.Mock).mock.calls[0][1];
    expect(body).toMatchObject({ heightCm: 177.8, ageYears: 31 });
  });

  it('refuses to save without a height, says why on its row, and sends nothing', async () => {
    signedIn({ heightCm: null, dateOfBirth: '1994-03-12' });
    pendingScan({}, { heightCm: noReading });
    const { findByRole, findByText } = await render(<InBodyConfirmScreen />);

    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    expect(await findByText('Enter your height')).toBeTruthy();
    expect(confirmBodyScan).not.toHaveBeenCalled();
  });

  it('never pre-fills a doubtful height reading, even when the profile has one', async () => {
    pendingScan({}, { heightCm: { value: 187.8, confidence: 0.6, readingNote: '' } });
    const { findByLabelText } = await render(<InBodyConfirmScreen />);

    expect((await findByLabelText('Height')).props.value).toBe('');
  });

  it("offers to update the profile after saving when the scan's height differs", async () => {
    pendingScan();
    const { findByRole, findByLabelText } = await render(<InBodyConfirmScreen />);
    await findByLabelText('Age');

    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/inbody', params: { heightPrompt: '177.8', profileHeight: '175' } });
  });

  it('just returns to InBody when the heights match', async () => {
    signedIn({ heightCm: 177.8, dateOfBirth: '1994-03-12' });
    pendingScan();
    const { findByRole, findByLabelText } = await render(<InBodyConfirmScreen />);
    await findByLabelText('Age');

    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    expect(mockReplace).toHaveBeenCalledWith('/inbody');
  });
});

// Slice E (scan-height-age-plan.md §4.3): some InBody models print FFMI. A printed one is shown and
// confirmed like BMI; a scan read before FFMI existed (no such field at all) still opens and saves.
describe('Confirm scan -- fat-free mass index', () => {
  it("pre-fills the sheet's FFMI and saves it", async () => {
    pendingScan({ fat_free_mass_index: 23.1 });
    const { findByRole, getByLabelText } = await render(<InBodyConfirmScreen />);

    expect(getByLabelText('Fat-free mass index').props.value).toBe('23.1');
    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    const body = (confirmBodyScan as jest.Mock).mock.calls[0][1];
    expect(body.measurements).toContainEqual(expect.objectContaining({ metric: 'fat_free_mass_index', value: 23.1 }));
  });

  it('opens and saves a scan read before FFMI existed, leaving the row empty', async () => {
    pendingScan();
    const pending = takePendingScan()!;
    const olderFields = Object.fromEntries(
      Object.entries(pending.extracted.fields).filter(([metric]) => metric !== 'fat_free_mass_index'),
    );
    setPendingScan({ ...pending, extracted: { ...pending.extracted, fields: olderFields as never } });
    const { findByRole, getByLabelText } = await render(<InBodyConfirmScreen />);

    expect(getByLabelText('Fat-free mass index').props.value).toBe('');
    await fireEvent.press(await findByRole('button', { name: 'Confirm & Save' }));

    const body = (confirmBodyScan as jest.Mock).mock.calls[0][1];
    expect(body.measurements.map((m: { metric: string }) => m.metric)).not.toContain('fat_free_mass_index');
  });
});
