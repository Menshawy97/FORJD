// Design-fidelity RED: the shipped login screen contradicts the prototype in four places —
// the headline reads "Log in" instead of "Welcome back", the subcopy line is missing
// entirely, "Forgot password?" is dim grey instead of accent orange, and the
// "No account? Create one" footer does not exist. Every assertion below is the prototype's
// `s_login()`.
//
// `design_handoff_forjd_mobile/01-screen-inventory.md` paraphrases the headline as "Log in";
// the prototype (and the screenshots) say "Welcome back". The prototype wins.
//
// Color assertion note: NativeWind classNames are not compiled to styles inside Jest —
// `className` passes through to props verbatim and no `style` is produced. So the accent
// color of "Forgot password?" is pinned through its token class, which is the only place
// the contract is observable in this environment.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: jest.fn(() => false),
}));

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[] | null;
}

function flatten(node: unknown): HostNode[] {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const host = node as HostNode;
  return [host, ...(host.children ?? []).flatMap(flatten)];
}

describe('login screen - design fidelity', () => {
  it('uses the prototype headline and subcopy', async () => {
    const { findByText, queryByText } = await renderRouter('src/app', { initialUrl: '/login' });

    await findByText('Welcome back');
    await findByText('Log in to continue your training.');
    expect(queryByText('Log in')).toBeNull();
  });

  it('renders "Forgot password?" in the accent orange token, not dim grey', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/login' });

    const forgot = await findByText('Forgot password?');
    expect(String(forgot.props.className)).toContain('text-accent');
    expect(String(forgot.props.className)).not.toContain('text-dim');
  });

  it('renders the "No account? Create one" footer', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/login' });

    await findByText(/No account\?/);
    await findByText('Create one');
  });

  it('renders the 20x20 back chevron glyph, not a text character', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/login' });
    await findByText('Welcome back');

    const nodes = flatten(toJSON());
    const back = nodes.find(
      (node) => node.type === 'RNSVGPath' && node.props.d === 'M12.5 4 6.5 10l6 6',
    );
    expect(back).toBeDefined();
    expect(back?.props.strokeWidth).toBe(1.7);
  });

  // Kept last in the file: a real navigation mutates expo-router's module-level route
  // store, which is only reset per test *file* (see welcome-login-cta.test.tsx's header).
  it('tapping "Create one" navigates to signup', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/login' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Create one'));
    await findByText('Create account');

    expect(rendered.getPathname()).toBe('/signup');
  });
});
