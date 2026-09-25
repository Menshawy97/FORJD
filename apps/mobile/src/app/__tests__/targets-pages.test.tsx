// Activity level and body goal (docs/product/scan-height-age-plan.md §4.5; designs approved
// 2026-09-25): two sign-up pages after Goals, and the same pages from Profile with Save.
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
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

import ActivityLevelScreen from '../activity-level';
import BodyGoalScreen from '../body-goal';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const render = (ui: ReactElement) => rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

function signedIn(profile: Record<string, unknown>) {
  (getMe as jest.Mock).mockResolvedValue({
    id: 'user-1',
    email: 'a@b.c',
    profile: { trainingGoals: [], activityLevel: null, bodyGoal: null, ...profile },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocalSearchParams.mockReturnValue({});
  (updateProfile as jest.Mock).mockResolvedValue({});
  signedIn({});
});

afterEach(() => {
  cleanup();
});

describe('How active are you? (sign-up)', () => {
  beforeEach(() => mockUseLocalSearchParams.mockReturnValue({ returnTo: 'newAccount' }));

  it('offers the five approved levels, saves the choice and continues to the goal page', async () => {
    const { findByRole, getByRole, getByText } = await render(<ActivityLevelScreen />);

    expect(getByText('How active are you?')).toBeTruthy();
    for (const label of ['Mostly sitting', 'Lightly active', 'Active', 'Very active', 'Athlete']) {
      expect(getByRole('radio', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    await fireEvent.press(getByRole('radio', { name: /^Very active/ }));
    await fireEvent.press(await findByRole('button', { name: 'Continue' }));

    expect(updateProfile).toHaveBeenCalledWith({ activityLevel: 'very_active' });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/body-goal?returnTo=newAccount'));
  });

  it('goes back to the training goals page', async () => {
    const { findByLabelText } = await render(<ActivityLevelScreen />);

    await fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/goals?returnTo=newAccount');
  });
});

describe("What's your goal? (sign-up)", () => {
  beforeEach(() => mockUseLocalSearchParams.mockReturnValue({ returnTo: 'newAccount' }));

  it('pre-selects body recomposition for someone who chose lose fat and get stronger', async () => {
    signedIn({ trainingGoals: ['lose_fat', 'get_stronger'] });
    const { getByRole } = await render(<BodyGoalScreen />);

    await waitFor(() => expect(getByRole('radio', { name: /^Body recomposition/ }).props.accessibilityState.selected).toBe(true));
  });

  it.each([
    [['lose_fat'], /^Lose fat/],
    [['build_muscle'], /^Build muscle/],
  ] as const)('pre-selects from training goals %j', async (trainingGoals, name) => {
    signedIn({ trainingGoals });
    const { getByRole } = await render(<BodyGoalScreen />);

    await waitFor(() => expect(getByRole('radio', { name }).props.accessibilityState.selected).toBe(true));
  });

  it('saves the goal, welcomes the new member and lands on home', async () => {
    signedIn({ trainingGoals: ['feel_better'] });
    const { findByRole, findByText } = await render(<BodyGoalScreen />);

    await fireEvent.press(await findByRole('radio', { name: /^Maintain/ }));
    await fireEvent.press(await findByRole('button', { name: 'Finish' }));

    expect(updateProfile).toHaveBeenCalledWith({ bodyGoal: 'maintain' });
    expect(await findByText('Welcome to FORJD!')).toBeTruthy();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });
});

describe('from Profile', () => {
  it('opens on the saved activity level and saves a change back to Profile', async () => {
    signedIn({ activityLevel: 'active' });
    const { findByRole, getByRole, getAllByText } = await render(<ActivityLevelScreen />);

    expect(getAllByText('Activity level')).toHaveLength(2); // the title and the section label
    await waitFor(() => expect(getByRole('radio', { name: /^Active/ }).props.accessibilityState.selected).toBe(true));
    await fireEvent.press(await findByRole('radio', { name: /^Athlete/ }));
    await fireEvent.press(await findByRole('button', { name: 'Save' }));

    expect(updateProfile).toHaveBeenCalledWith({ activityLevel: 'athlete' });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/profile'));
  });

  it('opens on the saved goal, not one guessed from training goals', async () => {
    signedIn({ bodyGoal: 'build_muscle', trainingGoals: ['lose_fat'] });
    const { getByRole } = await render(<BodyGoalScreen />);

    await waitFor(() => expect(getByRole('radio', { name: /^Build muscle/ }).props.accessibilityState.selected).toBe(true));
  });

  it('says a failed save failed and stays on the page', async () => {
    (updateProfile as jest.Mock).mockRejectedValue(new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, { status: 500 } as never));
    const { findByRole, findByText } = await render(<BodyGoalScreen />);

    await fireEvent.press(await findByRole('button', { name: 'Save' }));

    expect(await findByText('Could not save your goal. Please try again.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
