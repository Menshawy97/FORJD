// Manual InBody entry (docs/product/manual-inbody-entry-plan.md, design approved by the user):
// the Confirm-scan layout starting empty, weight required (body fat % optional since 2026-09-25),
// no photo, no AI.
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn(), push: jest.fn() },
}));

jest.mock('@/auth/apiClient', () => ({ createManualBodyScan: jest.fn() }));

import { createManualBodyScan } from '@/auth/apiClient';

import InBodyManualScreen from '../inbody-manual';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  (createManualBodyScan as jest.Mock).mockResolvedValue({ id: 'scan-9', source: 'manual' });
});

describe('manual InBody entry', () => {
  it('starts empty, titled "Enter values", with only weight marked required', async () => {
    const { getByText, getAllByText, getByLabelText } = await render(<InBodyManualScreen />);

    expect(getByText('Enter values')).toBeTruthy();
    expect(getAllByText('Required')).toHaveLength(1);
    expect(getByLabelText('Weight').props.value).toBe('');
    expect(getByLabelText('Body fat percentage').props.value).toBe('');
    expect(getByText(/is required — add any others/)).toBeTruthy();
  });

  // The user's rule (2026-09-25): body fat % is optional.
  it('saves with weight alone, without asking for body fat %', async () => {
    const { getByLabelText, getByRole, queryByText } = await render(<InBodyManualScreen />);

    await fireEvent.changeText(getByLabelText('Weight'), '82.4');
    await fireEvent.press(getByRole('button', { name: 'Save' }));

    expect(createManualBodyScan).toHaveBeenCalledWith({
      measuredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      measurements: [{ metric: 'weight_kg', value: 82.4, unit: 'kg' }],
    });
    expect(queryByText('Enter your body fat %')).toBeNull();
  });

  it('asks only for weight when nothing is entered, and sends nothing', async () => {
    const { getByRole, findByText, queryByText } = await render(<InBodyManualScreen />);

    await fireEvent.press(getByRole('button', { name: 'Save' }));

    expect(await findByText('Enter your weight')).toBeTruthy();
    expect(queryByText('Enter your body fat %')).toBeNull();
    expect(createManualBodyScan).not.toHaveBeenCalled();
  });

  it('saves the typed values with their units, then returns to InBody to confirm it', async () => {
    const { getByLabelText, getByRole } = await render(<InBodyManualScreen />);

    await fireEvent.changeText(getByLabelText('Weight'), '82.4');
    await fireEvent.changeText(getByLabelText('Body fat percentage'), '12.1');
    await fireEvent.changeText(getByLabelText('Skeletal muscle mass'), '41.8');
    await fireEvent.changeText(getByLabelText('Trunk'), '25');
    await fireEvent.press(getByRole('button', { name: 'Save' }));

    expect(createManualBodyScan).toHaveBeenCalledWith({
      measuredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      measurements: [
        { metric: 'weight_kg', value: 82.4, unit: 'kg' },
        { metric: 'skeletal_muscle_mass_kg', value: 41.8, unit: 'kg' },
        { metric: 'body_fat_percent', value: 12.1, unit: '%' },
        { metric: 'trunk', value: 25, unit: 'kg' },
      ],
    });
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/inbody', params: { saved: 'manual' } });
  });

  it('keeps the values and says so when saving fails', async () => {
    (createManualBodyScan as jest.Mock).mockRejectedValue(new Error('Network Error'));
    const { getByLabelText, getByRole, findByText } = await render(<InBodyManualScreen />);

    await fireEvent.changeText(getByLabelText('Weight'), '82.4');
    await fireEvent.changeText(getByLabelText('Body fat percentage'), '12.1');
    await fireEvent.press(getByRole('button', { name: 'Save' }));

    expect(await findByText(/Could not save these values/)).toBeTruthy();
    expect(getByLabelText('Weight').props.value).toBe('82.4');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Cancel goes back to InBody without saving', async () => {
    const { getByRole } = await render(<InBodyManualScreen />);

    await fireEvent.press(getByRole('button', { name: 'Cancel' }));

    expect(mockReplace).toHaveBeenCalledWith('/inbody');
    expect(createManualBodyScan).not.toHaveBeenCalled();
  });
});

describe('manual InBody entry -- value limits', () => {
  it('names an out-of-range value on its own row and sends nothing', async () => {
    const { getByLabelText, getByRole, findByText } = await render(<InBodyManualScreen />);

    await fireEvent.changeText(getByLabelText('Weight'), '82.4');
    await fireEvent.changeText(getByLabelText('Body fat percentage'), '12.1');
    await fireEvent.changeText(getByLabelText('Right arm'), '55');
    await fireEvent.press(getByRole('button', { name: 'Save' }));

    expect(await findByText('Must be between 0.5 and 50 kg')).toBeTruthy();
    expect(createManualBodyScan).not.toHaveBeenCalled();
  });
});
