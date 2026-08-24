// Phase J. Ports the prototype's `s_athlete()`, with deliberate divergences forced by the
// real backend (apps/api/src/athletes/athletes.service.ts):
//
//   - Ships **identity only**. §11 Q4's resolution: the stat tiles, personal records and
//     recent sessions all need Phase 10 leaderboard/analytics data that does not exist, so
//     they are omitted rather than faked. The footnote card describing them is omitted too
//     (it would describe screen content that isn't there).
//   - No handle line. slice2-screen-specs.md's decisions box drops the handle concept
//     entirely (no `handle` column, no username), same decision already enacted on
//     `(tabs)/profile.tsx` in Part 1.
//   - The prototype draws a specific "this profile is private" message when viewing a
//     STRANGER's private profile. The real backend deliberately makes a private profile and
//     a nonexistent one return byte-identical 404s (an anti-enumeration guarantee, since
//     accounts hold health data) — so the client must not reproduce prototype-specific
//     "private" messaging for a non-self view, which would leak exactly what the backend
//     refuses to leak. A load failure of any kind renders one generic not-found state.
//   - The self-view "your profile is private" nudge IS shown, because self always gets data
//     back from the endpoint regardless of the privacy flag (see athletes.service.ts) — the
//     current `publicProfile` value is carried as a query param from `privacy.tsx`, since
//     `PublicProfileResponse` deliberately never includes privacy flags.
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
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
  getAthlete: jest.fn(),
}));

import { getAthlete } from '@/auth/apiClient';
import AthleteScreen from '../athlete/[userId]';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const SELF_PROFILE = {
  userId: 'u1',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
  city: 'Alexandria',
  trainingGoals: [],
  activities: [],
  isSelf: true,
};

describe('AthleteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ userId: 'u1', publicProfile: 'true' });
    (getAthlete as jest.Mock).mockResolvedValue(SELF_PROFILE);
  });

  it('renders "Your public profile" and identity for a public self-view', async () => {
    const { findByText } = await render(<AthleteScreen />);

    expect(await findByText('Your public profile')).toBeTruthy();
    expect(await findByText('Ada Lovelace')).toBeTruthy();
    expect(await findByText('Alexandria')).toBeTruthy();
  });

  it('renders initials from the display name', async () => {
    const { findByText } = await render(<AthleteScreen />);

    expect(await findByText('AL')).toBeTruthy();
  });

  it('renders "Athlete" as the title for a non-self view', async () => {
    (getAthlete as jest.Mock).mockResolvedValue({ ...SELF_PROFILE, isSelf: false });

    const { findByText } = await render(<AthleteScreen />);

    expect(await findByText('Athlete')).toBeTruthy();
  });

  it('never renders a handle line — the concept was dropped', async () => {
    const { findByText, queryByText } = await render(<AthleteScreen />);

    await findByText('Ada Lovelace');
    expect(queryByText(/^@/)).toBeNull();
  });

  it('shows the private-profile nudge for a self-view with Public profile off', async () => {
    mockUseLocalSearchParams.mockReturnValue({ userId: 'u1', publicProfile: 'false' });

    const { findByText } = await render(<AthleteScreen />);

    expect(await findByText('Your profile is private')).toBeTruthy();
    expect(
      await findByText(
        'Turn on Public profile and other athletes will see your rank, records and recent sessions — nothing else.',
      ),
    ).toBeTruthy();
  });

  it('the private-profile nudge CTA opens Privacy Settings', async () => {
    mockUseLocalSearchParams.mockReturnValue({ userId: 'u1', publicProfile: 'false' });

    const { findByText } = await render(<AthleteScreen />);
    fireEvent.press(await findByText('Open Privacy Settings'));

    expect(mockReplace).toHaveBeenCalledWith('/privacy');
  });

  it('does not show the private-profile nudge once identity is showing', async () => {
    const { findByText, queryByText } = await render(<AthleteScreen />);

    await findByText('Ada Lovelace');
    expect(queryByText('Your profile is private')).toBeNull();
  });

  it('backs out to Privacy Settings', async () => {
    const { findByLabelText } = await render(<AthleteScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/privacy');
  });

  // react-reviewer, HIGH: Expo Router does not remount this screen for a param-only change
  // to the same dynamic route, so the effect must clear the previous athlete's data itself —
  // otherwise a second view (once a stranger-view entry point exists) would flash the FIRST
  // athlete's name/city while the second request is in flight.
  it('clears the previous athlete rather than flashing it while a new userId loads', async () => {
    const { findByText, queryByText, rerender } = await render(<AthleteScreen />);
    await findByText('Ada Lovelace');

    mockUseLocalSearchParams.mockReturnValue({ userId: 'u2', publicProfile: 'true' });
    (getAthlete as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    await rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AthleteScreen />
      </SafeAreaProvider>,
    );

    expect(queryByText('Ada Lovelace')).toBeNull();
  });

  it('shows one generic error rather than the prototype-specific "private" copy on any load failure', async () => {
    (getAthlete as jest.Mock).mockRejectedValue(
      new AxiosError('boom', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 404,
      } as never),
    );

    const { findByText, queryByText } = await render(<AthleteScreen />);

    expect(await findByText('Could not load this profile. Please try again.')).toBeTruthy();
    // The exact copy the prototype draws for a stranger's private profile must never appear —
    // reproducing it would leak the private/nonexistent distinction the backend's 404 hides.
    expect(queryByText(/keeps their profile private/)).toBeNull();
  });
});
