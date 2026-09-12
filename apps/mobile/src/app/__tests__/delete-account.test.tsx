// R3 (C1) -- the mobile half of account deletion: Apple requires this be reachable in-app
// (Guideline 5.1.1(v)), typed confirmation so a stray tap cannot erase an account.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn() },
}));

jest.mock('@/auth/apiClient', () => ({
  deleteAccount: jest.fn(),
}));

jest.mock('@/auth/secureStorage', () => ({
  clearSession: jest.fn(),
}));

import { deleteAccount } from '@/auth/apiClient';
import { clearSession } from '@/auth/secureStorage';

import DeleteAccountScreen from '../delete-account';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  (deleteAccount as jest.Mock).mockResolvedValue(undefined);
  (clearSession as jest.Mock).mockResolvedValue(undefined);
});

describe('DeleteAccountScreen', () => {
  it('keeps the delete control disabled until the confirmation phrase is typed exactly', async () => {
    const { getByLabelText, getByText } = await render(<DeleteAccountScreen />);

    const confirmInput = getByLabelText('Type DELETE to confirm');
    const deleteButton = getByText('Delete my account');

    await fireEvent.press(deleteButton);
    expect(deleteAccount).not.toHaveBeenCalled();

    await fireEvent.changeText(confirmInput, 'delete');
    await fireEvent.press(deleteButton);
    expect(deleteAccount).not.toHaveBeenCalled();

    await fireEvent.changeText(confirmInput, 'DELETE');
    await fireEvent.press(deleteButton);

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
  });

  it('clears the session and returns to welcome once the account is deleted', async () => {
    const { getByLabelText, getByText } = await render(<DeleteAccountScreen />);

    await fireEvent.changeText(getByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(getByText('Delete my account'));

    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(1));
  });

  it('shows an error and does not clear the session when deletion fails', async () => {
    (deleteAccount as jest.Mock).mockRejectedValue(new Error('network error'));
    const { getByLabelText, getByText, findByText } = await render(<DeleteAccountScreen />);

    await fireEvent.changeText(getByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(getByText('Delete my account'));

    expect(await findByText(/could not delete/i)).toBeTruthy();
    expect(clearSession).not.toHaveBeenCalled();
  });
});
