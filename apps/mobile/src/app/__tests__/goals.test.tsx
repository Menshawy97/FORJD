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
  getMe: jest.fn(),
  updateProfile: jest.fn(),
}));

import { getMe, updateProfile } from '@/auth/apiClient';
import GoalsScreen from '../goals';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const PROFILE = {
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: null,
  dateOfBirth: null,
  sex: null,
  heightCm: null,
  unitSystem: 'metric' as const,
  weightUnit: 'kg' as const,
  distanceUnit: 'km' as const,
  energyUnit: 'kcal' as const,
  trainingGoals: ['get_stronger'] as const,
  activities: ['strength', 'running'] as const,
  city: null,
  avatarUrl: null,
  plan: 'free' as const,
};

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  profile: PROFILE,
  privacy: {
    publicProfile: false,
    leaderboardOptIn: false,
    locationForLeaderboard: false,
    aiFeaturesConsent: false,
    aiFeaturesConsentAt: null,
    crashDiagnostics: false,
  },
};

describe('GoalsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    (getMe as jest.Mock).mockResolvedValue(ME);
  });

  it('renders the copy, both option groups, and pre-selects from the loaded profile', async () => {
    const { findByText, findByLabelText } = await render(<GoalsScreen />);

    expect(await findByText('What are you training for?')).toBeTruthy();
    expect(await findByText(/pick everything that applies/i)).toBeTruthy();
    expect(await findByText('Goals')).toBeTruthy();
    expect(await findByText('Activities')).toBeTruthy();
    expect(await findByText('HYROX')).toBeTruthy();

    expect((await findByLabelText('Get stronger')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('Strength')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('Running')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('Lose fat')).props.accessibilityState?.selected).toBe(false);
  });

  it('toggles a goal on and off', async () => {
    const { findByLabelText } = await render(<GoalsScreen />);

    fireEvent.press(await findByLabelText('Lose fat'));
    expect((await findByLabelText('Lose fat')).props.accessibilityState?.selected).toBe(true);

    fireEvent.press(await findByLabelText('Lose fat'));
    expect((await findByLabelText('Lose fat')).props.accessibilityState?.selected).toBe(false);
  });

  it('toggles an activity on and off independently of goals', async () => {
    const { findByLabelText } = await render(<GoalsScreen />);

    fireEvent.press(await findByLabelText('HYROX'));
    expect((await findByLabelText('HYROX')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('Strength')).props.accessibilityState?.selected).toBe(true);
  });

  it('disables Save when either list is emptied out', async () => {
    const { findByLabelText, findByRole } = await render(<GoalsScreen />);

    fireEvent.press(await findByLabelText('Get stronger'));

    const button = await findByRole('button', { name: 'Save' });
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('does not save when Save is disabled', async () => {
    const { findByLabelText, findByText } = await render(<GoalsScreen />);

    fireEvent.press(await findByLabelText('Get stronger'));
    fireEvent.press(await findByText('Save'));

    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('saves both lists, shows "Goals updated", and returns to profile by default', async () => {
    (updateProfile as jest.Mock).mockResolvedValue(PROFILE);

    const { findByText } = await render(<GoalsScreen />);

    fireEvent.press(await findByText('Save'));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        trainingGoals: ['get_stronger'],
        activities: ['strength', 'running'],
      }),
    );
    expect(await findByText('Goals updated')).toBeTruthy();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/profile'));
  });

  it('on the first-run path, saves, shows the welcome toast, and lands on home', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: 'newAccount' });
    (updateProfile as jest.Mock).mockResolvedValue(PROFILE);

    const { findByText } = await render(<GoalsScreen />);

    fireEvent.press(await findByText('Save'));

    expect(await findByText('Welcome to FORJD!')).toBeTruthy();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('the back chevron returns to profile by default', async () => {
    const { findByLabelText } = await render(<GoalsScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/profile');
  });

  it('on the first-run path, the back chevron returns to signup', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: 'newAccount' });

    const { findByLabelText } = await render(<GoalsScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/signup');
  });

  it('shows an inline error and does not navigate when Save fails', async () => {
    (updateProfile as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText } = await render(<GoalsScreen />);

    fireEvent.press(await findByText('Save'));

    expect(await findByText(/cannot reach forjd/i)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows an inline error instead of hanging forever when the initial load fails', async () => {
    (getMe as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText } = await render(<GoalsScreen />);

    expect(await findByText(/cannot reach forjd/i)).toBeTruthy();
  });

  it('still loads with empty selections when the profile is missing', async () => {
    (getMe as jest.Mock).mockResolvedValue({ ...ME, profile: null });

    const { findByText, findByLabelText } = await render(<GoalsScreen />);

    expect(await findByText('Save')).toBeTruthy();
    expect((await findByLabelText('Get stronger')).props.accessibilityState?.selected).toBe(
      false,
    );
  });
});
