// Design-fidelity RED: the shipped signup screen is missing the subcopy line and the
// password hint line, and labels the first field with its placeholder ("Your name") rather
// than the prototype's "Full name". All three come straight from the prototype's
// `s_signup()`.
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

describe('signup screen - design fidelity', () => {
  it('renders the prototype headline and subcopy', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/signup' });

    await findByText('Create account');
    await findByText('Start tracking everything in one place.');
  });

  it('renders the password requirements hint under the password field', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/signup' });

    // Deliberate deviation from the prototype (see PASSWORD_HINT in signup.tsx): the
    // prototype's wording omits the uppercase and symbol requirements that the contract and
    // the Supabase policy actually enforce, so following it verbatim guarantees a rejected
    // submission. Approved during the slice 14 device walk.
    await findByText(
      'Must be at least 8 characters, with an uppercase and a lowercase letter, a number, and a symbol.',
    );
  });

  it('labels the fields the way the prototype does', async () => {
    const { findByText, findByPlaceholderText } = await renderRouter('src/app', {
      initialUrl: '/signup',
    });

    await findByText('Full name');
    await findByText('Email');
    await findByText('Password');
    await findByPlaceholderText('Your name');
    await findByPlaceholderText('you@email.com');
    await findByPlaceholderText('Min. 8 characters');
  });

  it('renders the 20x20 back chevron glyph, not a text character', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/signup' });
    await findByText('Create account');

    const back = flatten(toJSON()).find(
      (node) => node.type === 'RNSVGPath' && node.props.d === 'M12.5 4 6.5 10l6 6',
    );
    expect(back).toBeDefined();
    expect(back?.props.strokeWidth).toBe(1.7);
  });
});
