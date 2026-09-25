// ADR-052: animation #9 plays over the app on every cold start, before Welcome (signed out)
// or Home (signed in). It is an overlay above the router, so it must not change where the
// auth gates send anyone -- only delay when they see it.

import { renderApp } from './render-app';

import { resetIntroForTests, shouldShowIntro } from '@/components/brand/intro-gate';

jest.mock('@/auth/secureStorage', () => ({
  getAccountId: jest.fn().mockResolvedValue('account-a'),
  hasSession: jest.fn(),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(),
  consumeSessionExpired: jest.fn(() => false),
}));

import { getCachedHasSession, hasSession } from '@/auth/secureStorage';

describe('cold-start intro', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The shared jest setup marks the intro shown so route-tree tests start on their screen;
    // this suite is the one place that wants the real cold start.
    resetIntroForTests();
  });

  // The intro's own dismissal (onDone at 3.3s) is covered by intro-splash.test.tsx. It can't be
  // waited out here: `renderApp` mounts under fake timers and then switches to real ones, so a
  // timer the intro schedules during that first render stays on the abandoned fake clock.
  it('covers Welcome with the intro for a signed-out user, with Welcome already routed beneath', async () => {
    (hasSession as jest.Mock).mockResolvedValue(false);
    (getCachedHasSession as jest.Mock).mockReturnValue(false);

    const rendered = renderApp({ initialUrl: '/' });
    const { findByTestId, findByText } = await rendered;

    await findByTestId('intro-splash');
    // The intro is a modal to screen readers, so the screen beneath counts as hidden while it
    // is up -- which is the point; the query has to ask for hidden elements to see it.
    await findByText(/Training\./, { includeHiddenElements: true });
    expect(rendered.getPathname()).toBe('/welcome');
    // Only marked when the intro finishes, so a layout re-mount mid-intro still shows it.
    expect(shouldShowIntro()).toBe(true);
  });

  it('plays before Home for a signed-in user', async () => {
    (hasSession as jest.Mock).mockResolvedValue(true);
    (getCachedHasSession as jest.Mock).mockReturnValue(true);

    const rendered = renderApp({ initialUrl: '/' });
    const { findByTestId, findByText } = await rendered;

    await findByTestId('intro-splash');
    await findByText('Home', { includeHiddenElements: true });
  });

  it('does not play again once it has played in this process', async () => {
    (hasSession as jest.Mock).mockResolvedValue(false);
    (getCachedHasSession as jest.Mock).mockReturnValue(false);
    const { markIntroShown } = jest.requireActual('@/components/brand/intro-gate');
    markIntroShown();

    const { findByText, queryByTestId } = await renderApp({ initialUrl: '/' });

    await findByText(/Training\./);
    expect(queryByTestId('intro-splash')).toBeNull();
  });
});
