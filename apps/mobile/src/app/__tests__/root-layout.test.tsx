// Phase 4 RED: root layout auth-redirect behaviour. Per ADR-011 (carried into RN), auth
// state is read once at redirect time, not reactively watched, so this asserts on the
// resulting route rather than on hook-subscription internals.
//
// `renderRouter()` in this expo-router version wraps @testing-library/react-native's
// `render()`, which is itself async (>=13.x) and returns a Promise. `renderRouter` attaches
// its extra helpers (getPathname, etc.) directly onto that Promise instance and returns it
// un-awaited, so the call site must both hold onto the returned value (for the extra
// helpers) and `await` it (to unwrap the actual query helpers, e.g. findByText).
import { renderRouter } from 'expo-router/testing-library';

// getCachedHasSession is what the root layout's useSyncExternalStore reads for its
// redirect decision (phase 5); hasSession() only drives the one-time initial "has fonts +
// auth state been checked" gate. Both are set together per test so they agree.
jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn(),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(),
}));

import { getCachedHasSession, hasSession } from '@/auth/secureStorage';

describe('root layout auth gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redirects an unauthenticated user to welcome and never mounts the tabs group', async () => {
    (hasSession as jest.Mock).mockResolvedValue(false);
    (getCachedHasSession as jest.Mock).mockReturnValue(false);

    const rendered = renderRouter('src/app', { initialUrl: '/' });
    const { findByText, queryByText } = await rendered;

    await findByText(/Training\./);

    // The tabs group must not be present in the final rendered tree for this user.
    expect(queryByText('Home')).toBeNull();
    expect(rendered.getPathname()).toBe('/welcome');
  });

  it('lets an authenticated user land on the tabs group', async () => {
    (hasSession as jest.Mock).mockResolvedValue(true);
    (getCachedHasSession as jest.Mock).mockReturnValue(true);

    const rendered = renderRouter('src/app', { initialUrl: '/' });
    const { findByText, queryByText } = await rendered;

    await findByText('Home');

    expect(queryByText(/Training\./)).toBeNull();
  });

  // `hasSession()` reads the platform keystore, and a keystore read is a real I/O call that
  // can reject — a locked device, a corrupted keychain entry, a SecureStore platform error.
  // The gate it feeds (`authChecked`) is what stands between the user and any UI at all, so
  // an unhandled rejection there is not "auth failed", it is a permanently blank screen with
  // no path out. Degrading to "not authenticated" is the only honest read of an unreadable
  // keystore, and it puts the user somewhere they can act (welcome -> log in) rather than
  // nowhere.
  it('still reaches the welcome screen when the keystore read rejects', async () => {
    (hasSession as jest.Mock).mockRejectedValue(new Error('SecureStore unavailable'));
    (getCachedHasSession as jest.Mock).mockReturnValue(false);

    const rendered = renderRouter('src/app', { initialUrl: '/' });
    const { findByText } = await rendered;

    await findByText(/Training\./);

    expect(rendered.getPathname()).toBe('/welcome');
  });
});
