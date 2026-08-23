// RED first: the profile screen. Until now this tab rendered the shared "coming soon"
// placeholder, which means the app shipped with **no way to sign out at all** — the single
// most important functional gap this slice closes.
//
// Structure and static sample copy are the prototype's `isProfile` branch of
// `FORJD mobile app design/FORJD Mobile.dc.html`.
//
// Mocking strategy follows login.test.tsx: mock `expo-secure-store` (the true native
// dependency) so the REAL secureStorage save/clear/notify plumbing runs — that is what lets
// the root layout's `useSyncExternalStore`-driven AuthGate see the sign-out and redirect. A
// hand-rolled `subscribeToSession` stub would break exactly the behaviour under test.
// `clearSession` is additionally wrapped in a jest.fn over the real implementation so the
// call itself is assertable without severing that plumbing.
//
// Slice-2 navigation off this screen (editProfile/units) has its own dedicated file,
// profile-navigation.test.tsx — not appended here. A separate spec file gets its own fresh
// module registry from Jest, which sidesteps a real problem: `clearSession()` in this file's
// logout test mutates the actual (singleton) secureStorage session, which nothing resets
// between `it()` blocks here, so any later test in this same file that needs an
// authenticated `/profile` render would inherit the signed-out state.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');
jest.mock('@/auth/secureStorage', () => {
  const actual = jest.requireActual('@/auth/secureStorage');
  return { ...actual, clearSession: jest.fn(actual.clearSession) };
});

import * as SecureStore from 'expo-secure-store';
import { clearSession } from '@/auth/secureStorage';

describe('profile screen', () => {
  beforeEach(() => {
    // Signed in: hasSession() reads a token, so the root layout renders the tabs group.
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('renders the identity row', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/profile' });

    await findByText('James Mitchell');
    await findByText('Free User');
    // Part 1.5: slice2-screen-specs.md's decisions box drops the `@jmitch` handle entirely
    // (no `handle` column, no username concept) — this line shows the city alone.
    await findByText('Alexandria');
  });

  it('renders the three labelled settings groups with the design rows and subtitles', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/profile' });

    await findByText('Training');
    await findByText('Goals & Activities');
    await findByText('Get stronger · Strength, Running');
    await findByText('Units & Preferences');
    await findByText('Metric · kg');

    await findByText('Data');
    await findByText('Connected Sources');
    await findByText('Apple Health, WHOOP, Health Connect');
    await findByText('InBody History');
    await findByText('Last scan 8 days ago');
    await findByText('Workout History');
    await findByText('147 sessions logged');

    await findByText('Privacy & permissions');
    await findByText('Privacy Settings');
    await findByText('Leaderboard, location, AI');
    await findByText('Notifications');
    await findByText('Workouts, recovery, PRs');
  });

  it('replaces the "coming soon" placeholder', async () => {
    const { findByText, queryByText } = await renderRouter('src/app', { initialUrl: '/profile' });

    await findByText('James Mitchell');
    expect(queryByText('profile — coming soon')).toBeNull();
  });

  it('renders the Log out control', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/profile' });

    await findByText('Log out');
  });

  // The behavioural test this whole slice exists for.
  it('tapping "Log out" clears the session and lands back on welcome', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Log out'));

    // The welcome headline — proof the AuthGate redirect actually fired.
    await findByText(/Training\./);

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('forjd.accessToken');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('forjd.refreshToken');
    expect(rendered.getPathname()).toBe('/welcome');
  });
});
