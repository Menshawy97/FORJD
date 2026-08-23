import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import { AxiosError } from 'axios';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) } }));

jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn(),
  updateProfile: jest.fn(),
}));

import { getMe, updateProfile } from '@/auth/apiClient';
import UnitsScreen from '../units';

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
  trainingGoals: [],
  activities: [],
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

describe('UnitsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMe as jest.Mock).mockResolvedValue(ME);
  });

  it('renders the title and pre-selects every option from the loaded profile', async () => {
    const { findByText, findByLabelText } = await render(<UnitsScreen />);

    expect(await findByText('Units & Preferences')).toBeTruthy();
    expect((await findByLabelText('Metric')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('kg')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('km')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('kcal')).props.accessibilityState?.selected).toBe(true);
  });

  /**
   * ADR-016: picking a system writes weight and distance together, and never energy — the
   * prototype's `setSystem` behaviour, now backed by three real fields instead of a single
   * derived one.
   */
  it('picking Imperial sets weight to lb and distance to mi, and leaves energy alone', async () => {
    const { findByLabelText } = await render(<UnitsScreen />);

    fireEvent.press(await findByLabelText('Imperial'));

    expect((await findByLabelText('lb')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('mi')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('kcal')).props.accessibilityState?.selected).toBe(true);
  });

  /**
   * The prototype's own documented inconsistency: overriding one unit does not pull the
   * system chip along with it, so the screen can show `Metric` next to `lb`. Preserved
   * exactly, per docs/design/slice2-screen-specs.md §3.5.
   */
  it('overriding one unit leaves the system chip on its current selection', async () => {
    const { findByLabelText } = await render(<UnitsScreen />);

    fireEvent.press(await findByLabelText('lb'));

    expect((await findByLabelText('lb')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('Metric')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('km')).props.accessibilityState?.selected).toBe(true);
  });

  it('energy is never touched by the system switch', async () => {
    const { findByLabelText } = await render(<UnitsScreen />);

    fireEvent.press(await findByLabelText('kJ'));
    fireEvent.press(await findByLabelText('Imperial'));

    expect((await findByLabelText('kJ')).props.accessibilityState?.selected).toBe(true);
  });

  it('saves all four selections and returns to profile', async () => {
    (updateProfile as jest.Mock).mockResolvedValue(PROFILE);

    const { findByLabelText, findByText } = await render(<UnitsScreen />);

    fireEvent.press(await findByLabelText('Imperial'));
    fireEvent.press(await findByText('Save Changes'));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        unitSystem: 'imperial',
        weightUnit: 'lb',
        distanceUnit: 'mi',
        energyUnit: 'kcal',
      }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/profile'));
  });

  it('shows the toast on save', async () => {
    (updateProfile as jest.Mock).mockResolvedValue(PROFILE);

    const { findByText } = await render(<UnitsScreen />);

    fireEvent.press(await findByText('Save Changes'));

    expect(await findByText('Preferences updated')).toBeTruthy();
  });

  /**
   * A missing profile row should never happen (Phase A creates one transactionally), but the
   * screen must not silently hang forever if it does — the same defensive stance
   * edit-profile.tsx already takes. Before this fix, `loaded` never became true when
   * `me.profile` was null, and the screen rendered nothing past the header, permanently.
   */
  it('still loads with sensible defaults when the profile is missing', async () => {
    (getMe as jest.Mock).mockResolvedValue({ ...ME, profile: null });

    const { findByText, findByLabelText } = await render(<UnitsScreen />);

    expect(await findByText('Save Changes')).toBeTruthy();
    expect((await findByLabelText('kg')).props.accessibilityState?.selected).toBe(true);
  });

  it('shows an inline error and does not navigate when Save fails', async () => {
    (updateProfile as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText } = await render(<UnitsScreen />);

    fireEvent.press(await findByText('Save Changes'));

    expect(await findByText(/cannot reach forjd/i)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /** Double-tapping Save while the first request is still in flight must not fire twice. */
  it('disables Save while a save is already in progress', async () => {
    let resolveSave: (value: typeof PROFILE) => void = () => {};
    (updateProfile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    const { findByRole, getByRole } = await render(<UnitsScreen />);

    const button = await findByRole('button', { name: 'Save Changes' });
    fireEvent.press(button);
    // Waits for `saving: true` to actually flush into the button's `disabled` prop before
    // the second tap — a real double-tap has some gap too, unlike two `fireEvent.press`
    // calls back-to-back with no render in between.
    await waitFor(() =>
      expect(getByRole('button', { name: 'Save Changes' }).props.accessibilityState?.disabled).toBe(
        true,
      ),
    );
    fireEvent.press(getByRole('button', { name: 'Save Changes' }));
    resolveSave(PROFILE);

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
  });

  it('back navigates to profile', async () => {
    const { findByLabelText } = await render(<UnitsScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/profile');
  });
});
