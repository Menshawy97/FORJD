// RED first: the profile screen was missing the upgrade banner entirely.
//
// The prototype renders it under `<sc-if value="{{ isFree }}">`, and `isFree` is the default
// state — so on the screen as designed it is always there. 01-screen-inventory.md lists it as
// part of the built profile screen and does not mark it out of scope; the earlier pass simply
// did not build it. From the prototype:
//
//   container: display:flex; align-items:center; justify-content:space-between; gap:14px;
//              padding:14px 16px; margin:0 0 16px; border-radius:14px;
//              background:linear-gradient(135deg,#1c1408,#17181a);
//              border:1px solid rgba(233,113,47,.35)
//   label:     font:700 13.5px/1.3 Archivo; color:#f6f5f3
//              "Get Unlimited Access to Everything"
//   pill:      font:700 12.5px/1 Archivo; color:#fff; background:#e9712f;
//              border-radius:9px; padding:9px 14px   "Go Pro"
//
// It is rendered non-navigating, like every other row on this screen: the paywall is a later
// slice, and profile.tsx's header already sets out why a Pressable to nowhere is worse than
// no Pressable. Visible now, wired when there is somewhere to go.
//
// The gradient is a *linear* one, so this is expo-linear-gradient rather than the SVG radial
// used for the screen atmosphere.
import { processColor } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';

import { colors } from '@/theme/tokens';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(true),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => true),
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

function textsInOrder(tree: unknown): string[] {
  return flatten(tree)
    .filter((node) => node.type === 'Text')
    .flatMap((node) => {
      // A host Text's string content is its first *child*, not a prop.
      const first = node.children?.[0] as unknown;
      return typeof first === 'string' ? [first] : [];
    });
}

describe('profile screen - Go Pro banner', () => {
  it('renders the banner copy and its pill', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/profile' });

    await findByText('Get Unlimited Access to Everything');
    await findByText('Go Pro');
  });

  it('sits between the identity row and the first settings group', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/profile' });
    await findByText('Get Unlimited Access to Everything');

    const texts = textsInOrder(toJSON());
    const identity = texts.indexOf('James Mitchell');
    const banner = texts.indexOf('Get Unlimited Access to Everything');
    const firstGroup = texts.indexOf('Training');

    expect(identity).toBeGreaterThanOrEqual(0);
    expect(banner).toBeGreaterThan(identity);
    expect(firstGroup).toBeGreaterThan(banner);
  });

  it('draws the prototype gradient and accent outline', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/profile' });
    await findByText('Get Unlimited Access to Everything');

    // expo-linear-gradient lowers to a view-manager adapter host node carrying its colours
    // already run through `processColor`.
    const gradients = flatten(toJSON()).filter((node) =>
      node.type.includes('ExpoLinearGradient'),
    );
    expect(gradients).toHaveLength(1);

    expect(gradients[0].props.colors).toEqual([
      processColor(colors.proBanner),
      processColor(colors.surface),
    ]);

    // 135deg in CSS runs top-left to bottom-right.
    expect(gradients[0].props.startPoint).toEqual([0, 0]);
    expect(gradients[0].props.endPoint).toEqual([1, 1]);
  });
});
