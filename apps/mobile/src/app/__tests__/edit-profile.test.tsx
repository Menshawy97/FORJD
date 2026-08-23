import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import { AxiosError } from 'axios';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// `ScreenBackground` reads the device inset and throws with no provider above it —
// `initialMetrics` gives it a synchronous frame instead of waiting on a native measurement
// that never arrives under Jest. Same pattern as screen-background.test.tsx.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) } }));

jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn(),
  updateProfile: jest.fn(),
}));

// A native module with nothing meaningful to render in Jest. The component itself is
// exercised for real; this stand-in just needs to accept the same props and let the test
// simulate a date pick by invoking onChange directly.
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props: { testID?: string }) => <View testID={props.testID ?? 'date-picker'} />,
  };
});

import { getMe, updateProfile } from '@/auth/apiClient';
import EditProfileScreen, { parseIsoDate } from '../edit-profile';

const PROFILE = {
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Ada Lovelace',
  dateOfBirth: '1990-07-04',
  sex: 'female' as const,
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

describe('EditProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the profile and pre-fills every field', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);

    const { findByDisplayValue, findByText } = await render(<EditProfileScreen />);

    expect(await findByDisplayValue('Ada Lovelace')).toBeTruthy();
    expect(await findByText('Edit Profile')).toBeTruthy();
  });

  // Part 1 (user-reported): the Birthday row opens a native date picker on tap, but nothing
  // visually signals that — it reads as a plain, disabled-looking text row. Fix reuses the
  // `chevron` glyph already used for this exact "tappable row" affordance in
  // (tabs)/profile.tsx, rather than inventing a calendar icon the prototype does not have
  // (the prototype gets a calendar affordance for free from the browser's native
  // `<input type="date">` chrome — see slice2-screen-specs.md §9 discrepancy #7).
  it('shows a tap affordance on the Birthday row so it does not look inert', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);

    const { findByLabelText, toJSON } = await render(<EditProfileScreen />);
    await findByLabelText('Birthday');

    interface HostNode {
      type: string;
      props: Record<string, unknown>;
      children: HostNode[] | null;
    }
    function flatten(node: unknown): HostNode[] {
      if (!node || typeof node !== 'object') return [];
      const host = node as HostNode;
      return [host, ...(host.children ?? []).flatMap(flatten)];
    }

    const CHEVRON_PATH = 'm9.6 6.4 5 5.6-5 5.6';
    const hasChevron = flatten(toJSON()).some(
      (node) => node.type === 'RNSVGPath' && node.props.d === CHEVRON_PATH,
    );
    expect(hasChevron).toBe(true);
  });

  it('back navigates to the profile tab, same as Save', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);

    const { findByLabelText } = await render(<EditProfileScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/profile');
  });

  it('marks exactly one sex chip selected, matching the loaded profile', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);

    const { findByLabelText } = await render(<EditProfileScreen />);

    const female = await findByLabelText('Female');
    const male = await findByLabelText('Male');
    expect(female.props.accessibilityState?.selected).toBe(true);
    expect(male.props.accessibilityState?.selected).toBe(false);
  });

  it('switches the selected chip on tap, and only one is ever selected', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);

    const { findByLabelText } = await render(<EditProfileScreen />);

    fireEvent.press(await findByLabelText('Rather not say'));

    expect((await findByLabelText('Rather not say')).props.accessibilityState?.selected).toBe(
      true,
    );
    expect((await findByLabelText('Female')).props.accessibilityState?.selected).toBe(false);
  });

  it('edits the name field', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);

    const { findByLabelText, findByDisplayValue } = await render(<EditProfileScreen />);

    const name = await findByLabelText('Name');
    fireEvent.changeText(name, 'Ada King');

    expect(await findByDisplayValue('Ada King')).toBeTruthy();
  });

  it('saves the current field values and returns to profile', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);
    (updateProfile as jest.Mock).mockResolvedValue({ ...PROFILE, displayName: 'Ada King' });

    const { findByLabelText, findByText } = await render(<EditProfileScreen />);

    fireEvent.changeText(await findByLabelText('Name'), 'Ada King');
    fireEvent.press(await findByText('Save Changes'));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        displayName: 'Ada King',
        dateOfBirth: '1990-07-04',
        sex: 'female',
      }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/profile'));
  });

  it('shows the toast before navigating away', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);
    (updateProfile as jest.Mock).mockResolvedValue(PROFILE);

    const { findByText } = await render(<EditProfileScreen />);

    fireEvent.press(await findByText('Save Changes'));

    expect(await findByText('Profile updated')).toBeTruthy();
  });

  /**
   * Always `Free plan`/non-navigating — billing is Phase 10, and the contract's `plan` field
   * is hardcoded server-side. Pressing it must not crash or navigate anywhere.
   */
  it('renders the plan row as Free plan, non-navigating', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);

    const { findByText } = await render(<EditProfileScreen />);

    expect(await findByText('Free plan')).toBeTruthy();
    expect(await findByText('Upgrade for unlimited access')).toBeTruthy();

    fireEvent.press(await findByText('Go Pro'));

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows an inline error when the initial load fails, offline', async () => {
    (getMe as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText } = await render(<EditProfileScreen />);

    expect(await findByText(/cannot reach forjd/i)).toBeTruthy();
  });

  it('shows an inline error and does not navigate when Save fails', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);
    (updateProfile as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText } = await render(<EditProfileScreen />);

    fireEvent.press(await findByText('Save Changes'));

    expect(await findByText(/cannot reach forjd/i)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * DOB parsing is a classic timezone trap: `new Date('1990-07-04')` is UTC midnight, and
   * formatting it through a locale-aware call reads back through the *local* offset — in any
   * timezone behind UTC that silently becomes July 3rd. This asserts the displayed value
   * survives the round trip regardless of the runtime's timezone.
   */
  it('shows the loaded birthday', async () => {
    (getMe as jest.Mock).mockResolvedValue(ME);

    const { findByText } = await render(<EditProfileScreen />);

    expect(await findByText(/july 4, 1990/i)).toBeTruthy();
  });

  /**
   * The regression this guards against: `new Date('1990-07-04')` parses the string as UTC
   * *midnight*, which reads back a day early through local getters in any timezone behind
   * UTC — invisible on a positive-offset machine, where "a day early" never crosses back over
   * local midnight. `process.env.TZ` mutation was tried first and does not work here — this
   * Hermes/jest-expo environment does not re-read it after startup, so a test built that way
   * passed identically whether the bug was present or not, which is not a regression test.
   *
   * A `getUTCHours() !== 0` check was tried next, but that fails on a UTC-zone CI runner: a
   * local-time construction genuinely *is* UTC midnight when the local zone is UTC itself.
   * This asserts against `new Date(1990, 6, 4)` directly instead — the same local-time
   * constructor `parseIsoDate` itself calls — which matches in every timezone including UTC,
   * and would still fail against the naive `new Date(iso)` implementation on any non-UTC
   * runner (confirmed locally at UTC+3 before this form was kept).
   */
  it('parses the ISO date via the local calendar, not a UTC string parse', () => {
    const parsed = parseIsoDate('1990-07-04');

    expect(parsed.getFullYear()).toBe(1990);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(4);
    expect(parsed.getTime()).toBe(new Date(1990, 6, 4).getTime());
  });
});
