import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import { AxiosError } from 'axios';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockUseLocalSearchParams = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/auth/apiClient', () => ({
  updateProfile: jest.fn(),
}));

import { updateProfile } from '@/auth/apiClient';
import LocationScreen from '../location';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('LocationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
  });

  it('renders the explainer copy and the Q&A block', async () => {
    const { findByText } = await render(<LocationScreen />);

    expect(await findByText('City Leaderboard Location')).toBeTruthy();
    expect(
      await findByText(/FORJD uses your approximate location/i),
    ).toBeTruthy();
    expect(await findByText('Why is location used?')).toBeTruthy();
    expect(await findByText('When is it used?')).toBeTruthy();
    expect(await findByText('What if you decline?')).toBeTruthy();
  });

  it('defaults the tab bar to Rank when no back param is given', async () => {
    const { findByLabelText } = await render(<LocationScreen />);

    expect((await findByLabelText('Rank')).props.accessibilityState?.selected).toBe(true);
  });

  it('shows the tab bar on Profile when back=privacy', async () => {
    mockUseLocalSearchParams.mockReturnValue({ back: 'privacy' });

    const { findByLabelText } = await render(<LocationScreen />);

    expect((await findByLabelText('Profile')).props.accessibilityState?.selected).toBe(true);
  });

  it('Allow Location writes city and shows the assigned toast', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({});

    const { findByText } = await render(<LocationScreen />);

    fireEvent.press(await findByText('Allow Location'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ city: 'Alexandria' }));
    expect(await findByText('Assigned to Alexandria')).toBeTruthy();
  });

  it('Allow Location navigates to the rank tab by default', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({});

    const { findByText } = await render(<LocationScreen />);

    fireEvent.press(await findByText('Allow Location'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/rank'));
  });

  it('Allow Location navigates to the back param destination when set', async () => {
    mockUseLocalSearchParams.mockReturnValue({ back: 'privacy' });
    (updateProfile as jest.Mock).mockResolvedValue({});

    const { findByText } = await render(<LocationScreen />);

    fireEvent.press(await findByText('Allow Location'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/privacy'));
  });

  it('shows an inline error and does not navigate when Allow fails', async () => {
    (updateProfile as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText } = await render(<LocationScreen />);

    fireEvent.press(await findByText('Allow Location'));

    expect(await findByText(/cannot reach forjd/i)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Not Now navigates away without writing anything', async () => {
    const { findByText } = await render(<LocationScreen />);

    fireEvent.press(await findByText('Not Now'));

    expect(updateProfile).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/rank');
  });

  it('the back chevron navigates to the same destination as Not Now', async () => {
    mockUseLocalSearchParams.mockReturnValue({ back: 'privacy' });

    const { findByLabelText } = await render(<LocationScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/privacy');
  });
});
