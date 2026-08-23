// RED first: two things the prototype's `btn()` does that no button in the app did.
//
//   primary: boxShadow:'0 6px 22px rgba(233,113,47,.22)'
//            'style-active':'transform:scale(.985)'
//   ghost:   'style-hover':'background:rgba(255,255,255,.04);color:#f6f5f3'
//
// 1. The glow. `tailwind.config.ts` has carried a `primary-button` boxShadow token since the
//    tokens were transcribed, and `grep -rn "shadow-" src/` returned nothing — the token was
//    written down and never used, so every primary CTA sat flat on the background.
//
// 2. The press. `05-interactions.md` gives `transform: scale(.985)` for any button active
//    state, and nothing in src/ used `style={({ pressed }) => …}`, so no control acknowledged
//    a touch at all.
//
// What is and is not verifiable here: the shadow is a NativeWind class, and NativeWind's
// className->style transform does not run under Jest, so the *rendered shadow* cannot be
// asserted — only that the class is applied, the same compromise
// signup-field-highlight.test.tsx documents. The press state is different: it is a plain
// style function, so its output is real style and is asserted as such.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
}));

interface StyledNode {
  props: { className?: unknown; style?: unknown };
}

function classesOf(node: StyledNode): string {
  return String(node.props.className ?? '');
}

function flatStyle(node: StyledNode): Record<string, unknown> {
  const style = node.props.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.flat(Infinity))
    : ((style ?? {}) as never);
}

/**
 * `fireEvent.press`/`'pressIn'` call the handler props directly and never touch Pressability's
 * internal state, so `pressed` stays false and the style callback is never re-run with it —
 * the state under test would be unobservable. The responder events below are what Pressability
 * actually listens on, so driving those puts the component into the real pressed state.
 *
 * `persist` is stubbed because Pressability calls it on the event it receives.
 */
const responderEvent = {
  persist: () => {},
  nativeEvent: {
    touches: [],
    changedTouches: [],
    identifier: 1,
    locationX: 1,
    locationY: 1,
    pageX: 1,
    pageY: 1,
    target: 1,
    timestamp: 0,
    force: 0,
  },
};

const hold = (node: StyledNode) => fireEvent(node as never, 'responderGrant', responderEvent);

describe('primary CTAs carry the accent glow', () => {
  it.each([
    ['/welcome', /Training\./, 'Create Account'],
    ['/login', 'Welcome back', 'Log In'],
    ['/signup', 'Create account', 'Create Account'],
  ] as const)('%s', async (url, settleOn, label) => {
    const { findByText, findByLabelText } = await renderRouter('src/app', { initialUrl: url });
    await findByText(settleOn);

    expect(classesOf(await findByLabelText(label))).toContain('shadow-primary-button');
  });
});

describe('controls acknowledge a press', () => {
  it('scales the welcome primary CTA to .985 while held', async () => {
    const { findByText, findByLabelText } = await renderRouter('src/app', {
      initialUrl: '/welcome',
    });
    await findByText(/Training\./);

    const cta = () => findByLabelText('Create Account');

    expect(flatStyle(await cta()).transform).toBeUndefined();

    await hold(await cta());
    expect(flatStyle(await cta()).transform).toEqual([{ scale: 0.985 }]);

    // Not asserted: that the transform clears when the finger lifts. Pressability defers the
    // un-press behind its own timers, so observing it here would be a test of React Native's
    // scheduling rather than of this screen — and `pressed === false` producing no transform
    // is already the assertion three lines up, before any press happened.
  });

  // The ghost variant gets the fill and text lift the prototype gives it on hover — a
  // pointer state that on a touch device only ever surfaces as "pressed" — but, per
  // press-feedback.ts (Part 1.3 of ui-remediation-and-phase-i-plan.md), NOT the primary
  // CTA's scale transform: the prototype's `btn()` has no active/pressed rule for ghost.
  it('fills and brightens the welcome ghost CTA while held, with no scale transform', async () => {
    const { findByText, findByLabelText } = await renderRouter('src/app', {
      initialUrl: '/welcome',
    });
    await findByText(/Training\./);

    const ghost = () => findByLabelText('Log In');
    const ghostLabel = () => findByText('Log In');

    expect(classesOf(await ghostLabel())).toContain('text-dim');

    await hold(await ghost());

    expect(flatStyle(await ghost())).toMatchObject({
      backgroundColor: 'rgba(255,255,255,.04)',
    });
    expect(flatStyle(await ghost()).transform).toBeUndefined();
    expect(classesOf(await ghostLabel())).toContain('text-text');
  });
});
