// Plan step 6 / slice2-screen-specs.md §6. Unlike `notifs`, this screen has a real backend:
// PATCH /api/v1/users/me/privacy already exists, so the spec's "blocked on backend" note is
// stale.
//
// Two things this file guards specifically:
//   - All THREE permission rows render. The handoff doc undercounts them (§9 discrepancy #5) —
//     "Preview my public profile" is the one it drops.
//   - The leaderboard/location dependency is mirrored client-side in BOTH directions, so the
//     server's 400 (locationForLeaderboard without leaderboardOptIn) is structurally
//     unreachable: parent off turns child off; child on turns parent on.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import { AxiosError } from 'axios';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  Link: 'Link',
}));

jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn(),
  updatePrivacy: jest.fn(),
}));

import { getMe, updatePrivacy } from '@/auth/apiClient';
import PrivacyScreen from '../privacy';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

/** Real accounts start all-off — §6.4's defaults describe the prototype's local state. */
const PRIVACY = {
  publicProfile: false,
  leaderboardOptIn: false,
  locationForLeaderboard: false,
  aiFeaturesConsent: false,
  aiFeaturesConsentAt: null,
  crashDiagnostics: false,
};

const ME = { id: 'u1', email: 'a@example.com', profile: null, privacy: PRIVACY };

/** Row order on screen: leaderboard, location, ai, publicProfile, crashDiagnostics. */
function checkedStates(rows: Array<{ props: Record<string, unknown> }>): boolean[] {
  return rows.map(
    (row) => (row.props.accessibilityState as { checked: boolean }).checked,
  );
}

describe('PrivacyScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMe as jest.Mock).mockResolvedValue(ME);
    (updatePrivacy as jest.Mock).mockResolvedValue(PRIVACY);
  });

  it('renders the header, intro copy and all five toggle rows', async () => {
    const { findByText } = await render(<PrivacyScreen />);

    expect(await findByText('Privacy Settings')).toBeTruthy();
    expect(
      await findByText(
        'You choose what leaves your phone. Health data never goes to advertisers.',
      ),
    ).toBeTruthy();
    expect(await findByText('Appear on city leaderboards')).toBeTruthy();
    expect(await findByText('Use approximate location')).toBeTruthy();
    // British spelling, as the prototype has it (§6.2).
    expect(
      await findByText('Analyse your training and recovery to write your weekly insights.'),
    ).toBeTruthy();
    expect(await findByText('AI insights')).toBeTruthy();
    expect(await findByText('Public profile')).toBeTruthy();
    expect(await findByText('Crash diagnostics')).toBeTruthy();
    expect(await findByText('Anonymous crash reports only — never health data.')).toBeTruthy();
  });

  it('renders all three permission rows — the handoff doc undercounts these', async () => {
    const { findByText } = await render(<PrivacyScreen />);

    expect(await findByText('Permissions')).toBeTruthy();
    expect(await findByText('Location permission')).toBeTruthy();
    expect(await findByText('Preview my public profile')).toBeTruthy();
    expect(await findByText('Download my data')).toBeTruthy();
  });

  it('renders from server state, not the prototype defaults', async () => {
    (getMe as jest.Mock).mockResolvedValue({
      ...ME,
      privacy: { ...PRIVACY, aiFeaturesConsent: true, crashDiagnostics: true },
    });

    const { findAllByRole } = await render(<PrivacyScreen />);

    expect(checkedStates(await findAllByRole('switch'))).toEqual([
      false,
      false,
      true,
      false,
      true,
    ]);
  });

  it('turning the leaderboard parent off cascades the location child off', async () => {
    (getMe as jest.Mock).mockResolvedValue({
      ...ME,
      privacy: { ...PRIVACY, leaderboardOptIn: true, locationForLeaderboard: true },
    });

    const { findByText, findAllByRole } = await render(<PrivacyScreen />);
    fireEvent.press(await findByText('Appear on city leaderboards'));

    await waitFor(async () => {
      const [leaderboard, location] = checkedStates(await findAllByRole('switch'));
      expect(leaderboard).toBe(false);
      expect(location).toBe(false);
    });
  });

  it('turning the location child on turns the leaderboard parent on', async () => {
    const { findByText, findAllByRole } = await render(<PrivacyScreen />);
    fireEvent.press(await findByText('Use approximate location'));

    await waitFor(async () => {
      const [leaderboard, location] = checkedStates(await findAllByRole('switch'));
      expect(leaderboard).toBe(true);
      expect(location).toBe(true);
    });
  });

  it('Save sends all five flags, toasts, and navigates to the profile tab', async () => {
    const { findByText } = await render(<PrivacyScreen />);
    fireEvent.press(await findByText('Crash diagnostics'));
    fireEvent.press(await findByText('Save'));

    await waitFor(() => {
      expect(updatePrivacy).toHaveBeenCalledWith({
        publicProfile: false,
        leaderboardOptIn: false,
        locationForLeaderboard: false,
        aiFeaturesConsent: false,
        crashDiagnostics: true,
      });
    });
    expect(await findByText('Privacy settings updated')).toBeTruthy();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/profile'));
  });

  it('shows an inline error and does not navigate when saving fails', async () => {
    (updatePrivacy as jest.Mock).mockRejectedValue(
      new AxiosError('boom', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status: 500,
      } as never),
    );

    const { findByText } = await render(<PrivacyScreen />);
    fireEvent.press(await findByText('Save'));

    expect(
      await findByText('Could not update your privacy settings. Please try again.'),
    ).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows an inline error rather than a blank screen when the load fails', async () => {
    (getMe as jest.Mock).mockRejectedValue(
      new AxiosError('boom', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status: 500,
      } as never),
    );

    const { findByText } = await render(<PrivacyScreen />);

    expect(
      await findByText('Could not load your privacy settings. Please try again.'),
    ).toBeTruthy();
  });

  it('the Download my data row does not navigate', async () => {
    const { findByText } = await render(<PrivacyScreen />);

    fireEvent.press(await findByText('Download my data'));

    expect(mockReplace).not.toHaveBeenCalled();
  });

  // Phase J. Self always gets data back from GET /athletes/:userId regardless of the privacy
  // flag (see athletes.service.ts), so PublicProfileResponse deliberately carries no privacy
  // flags — the current value has to travel as a query param, since it's the one piece of
  // state privacy.tsx already holds that the athlete screen cannot otherwise learn.
  it('Preview my public profile opens the athlete screen for the viewer, with the current flag', async () => {
    (getMe as jest.Mock).mockResolvedValue({
      ...ME,
      privacy: { ...PRIVACY, publicProfile: true },
    });

    const { findByText } = await render(<PrivacyScreen />);
    fireEvent.press(await findByText('Preview my public profile'));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/athlete/[userId]',
      params: { userId: 'u1', publicProfile: 'true' },
    });
  });

  // react-reviewer, HIGH: rendering the inert rows with accessibilityRole="button" makes a
  // screen reader announce "button", the user double-taps, and nothing happens — exactly the
  // "Pressable to nowhere" outcome the inert rows exist to avoid. Only the row that really
  // navigates should read as actionable, and only it should carry the trailing chevron.
  it('announces only the navigable permission row as a button', async () => {
    const { findByText } = await render(<PrivacyScreen />);

    const navigable = (await findByText('Location permission')).parent?.parent;
    const inert = (await findByText('Download my data')).parent?.parent;

    expect(navigable?.props.accessibilityRole).toBe('button');
    expect(inert?.props.accessibilityRole).toBeUndefined();
  });

  it('renders the AI insights footnote', async () => {
    const { findByText } = await render(<PrivacyScreen />);

    expect(
      await findByText(
        'Turning off AI insights stops new insights being generated. Your history stays on your device either way.',
      ),
    ).toBeTruthy();
  });
});
