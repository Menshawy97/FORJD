// RED first: nothing in src/ imported react-native-safe-area-context, though it is a
// dependency.
//
// The prototype opens every screen with a `height:52px; flex:none` status-bar row, and the
// app had no equivalent. Profile's identity row therefore sat under the notch, and
// login/signup used `pt-16` — 64px, which is neither the design's 52 nor anything the device
// reported. A constant cannot be right on both a notched iPhone and a flat-topped Android,
// which is the whole reason the inset API exists.
//
// The inset is applied once, by `ScreenBackground`, because it is the one thing every screen
// already goes through — see src/components/screen-background.tsx.
import { renderRouter } from 'expo-router/testing-library';

// A notched-phone inset, distinct from every constant in the codebase so a hardcoded value
// cannot pass by coincidence.
const TOP_INSET = 47;

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: TOP_INSET, bottom: 34, left: 0, right: 0 }),
  };
});

// Defaults to unauthenticated: `login`/`signup`/`welcome` need that to render at all now that
// _layout.tsx's AuthenticatedGate (Part 1.1 of ui-remediation-and-phase-i-plan.md) redirects an
// authenticated user away from `login`/`welcome`. `profile` overrides to authenticated
// per-test below, since it is gated the other way.
jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
}));

import { getCachedHasSession, hasSession } from '@/auth/secureStorage';

function authenticate() {
  (hasSession as jest.Mock).mockResolvedValue(true);
  (getCachedHasSession as jest.Mock).mockReturnValue(true);
}

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

function paddingTops(tree: unknown): number[] {
  return flatten(tree)
    .map((node) => {
      const style = node.props.style;
      const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity)) : style;
      return (flat as { paddingTop?: unknown } | undefined)?.paddingTop;
    })
    .filter((value): value is number => typeof value === 'number');
}

async function open(url: string, settleOn: RegExp | string) {
  const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: url });
  await findByText(settleOn);
  return toJSON();
}

describe('safe area', () => {
  beforeEach(() => {
    (hasSession as jest.Mock).mockResolvedValue(false);
    (getCachedHasSession as jest.Mock).mockReturnValue(false);
  });

  it('offsets login by the device inset', async () => {
    expect(paddingTops(await open('/login', 'Welcome back'))).toContain(TOP_INSET);
  });

  it('offsets signup by the device inset', async () => {
    expect(paddingTops(await open('/signup', 'Create account'))).toContain(TOP_INSET);
  });

  it('offsets profile by the device inset, so the identity row clears the notch', async () => {
    authenticate();
    expect(paddingTops(await open('/profile', 'James Mitchell'))).toContain(TOP_INSET);
  });

  it('offsets welcome by the device inset', async () => {
    expect(paddingTops(await open('/welcome', /Training\./))).toContain(TOP_INSET);
  });

  it('no longer pads login or signup with the hardcoded pt-16', async () => {
    for (const [url, settleOn] of [
      ['/login', 'Welcome back'],
      ['/signup', 'Create account'],
    ] as const) {
      const classNames = flatten(await open(url, settleOn))
        .map((node) => String(node.props.className ?? ''))
        .join(' ');

      expect(classNames).not.toContain('pt-16');
    }
  });
});
