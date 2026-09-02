// Part 1.1 RED: the inverse auth gate. `AuthGate` in `_layout.tsx` only ever redirected an
// *unauthenticated* user off an authenticated route; nothing bounced an already-signed-in
// user off the public screens. That is the safety net for the swipe-back bug (see
// swipe-back-stack-reset.test.tsx for the primary fix): even if a stale/phantom `welcome` or
// `login` entry were ever reachable again, an authenticated session lands back on `/`
// immediately instead of presenting "Create Account" / "Log In".
//
// `signup` is deliberately excluded from this redirect — see _layout.tsx's comment. `saveSession`
// fires before signup's own navigation, so the user is authenticated while still on `/signup`
// for the first-run `goals` screen's back-chevron trap (slice2-screen-specs.md §4.1/§4.6,
// deliberately implemented and tested in Phase H). Gating `signup` here would break that.
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn(),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(),
  consumeSessionExpired: jest.fn(() => false),
}));

import { getCachedHasSession, hasSession } from '@/auth/secureStorage';

describe('authenticated user on a public route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (hasSession as jest.Mock).mockResolvedValue(true);
    (getCachedHasSession as jest.Mock).mockReturnValue(true);
  });

  it('redirects away from /welcome to the tabs', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/welcome' });
    const { findByText, queryByText } = await rendered;

    await findByText('Home');

    expect(queryByText(/Training\./)).toBeNull();
    expect(rendered.getPathname()).toBe('/');
  });

  it('redirects away from /login to the tabs', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/login' });
    const { findByText, queryByText } = await rendered;

    await findByText('Home');

    expect(queryByText('Welcome back')).toBeNull();
    expect(rendered.getPathname()).toBe('/');
  });

  it('does not redirect away from /signup — the first-run back-chevron trap depends on it', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/signup' });
    const { findByText } = await rendered;

    await findByText('Create account');

    expect(rendered.getPathname()).toBe('/signup');
  });
});
