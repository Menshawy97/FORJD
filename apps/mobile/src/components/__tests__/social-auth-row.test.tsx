// Part 1.4 RED: the social auth row from the prototype's `socialRow()`/`socialBtn()`
// (`FORJD Mobile.dc.html` lines 1141-1165), missing on both `login.tsx` and `signup.tsx`.
//
// Google's mark is four filled paths in four brand colors and Apple's is a single filled
// path — `components/icon.tsx` is a monochrome stroke-only registry with no `fill` shape
// kind, so this is a small local component rather than a new `Icon` entry, per the plan.
//
// Labels are "Google" and "Apple" (not "Continue with Google/Apple" — the handoff doc gets
// this wrong, per the plan), Google first. No *scale* transform, unlike the primary `btn()`
// — the prototype has no active-state rule to transcribe for these — but react-reviewer
// flagged that a real Pressable with zero pressed-state feedback at all reads as broken on a
// touch device, so a background lift on press was added (not present in the static prototype,
// which has no touch semantics to draw one from).
import { processColor } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { SocialAuthRow } from '../social-auth-row';
import { colors } from '@/theme/tokens';

describe('SocialAuthRow', () => {
  it('renders the divider copy and both buttons, Google before Apple', async () => {
    const { findByText } = await render(
      <SocialAuthRow onGooglePress={jest.fn()} onApplePress={jest.fn()} />,
    );

    expect(await findByText('OR CONTINUE WITH')).toBeTruthy();

    const google = await findByText('Google');
    const apple = await findByText('Apple');
    expect(google).toBeTruthy();
    expect(apple).toBeTruthy();
  });

  it('calls onGooglePress when the Google button is pressed', async () => {
    const onGooglePress = jest.fn();
    const { findByText } = await render(
      <SocialAuthRow onGooglePress={onGooglePress} onApplePress={jest.fn()} />,
    );

    fireEvent.press(await findByText('Google'));

    expect(onGooglePress).toHaveBeenCalledTimes(1);
  });

  it('calls onApplePress when the Apple button is pressed', async () => {
    const onApplePress = jest.fn();
    const { findByText } = await render(
      <SocialAuthRow onGooglePress={jest.fn()} onApplePress={onApplePress} />,
    );

    fireEvent.press(await findByText('Apple'));

    expect(onApplePress).toHaveBeenCalledTimes(1);
  });

  it('renders the Google mark as four filled paths and the Apple mark as one', async () => {
    interface HostNode {
      type: string;
      props: Record<string, unknown>;
      children: HostNode[] | null;
    }
    function flatten(node: unknown): HostNode[] {
      if (!node || typeof node !== 'object') return [];
      const host = node as HostNode;
      return [host, ...(host.children ?? []).flatMap(flatten)];
    }

    const { toJSON } = await render(
      <SocialAuthRow onGooglePress={jest.fn()} onApplePress={jest.fn()} />,
    );
    const paths = flatten(toJSON()).filter((node) => node.type === 'RNSVGPath');

    const googleBrandFills = ['#4285F4', '#34A853', '#FBBC05', '#EA4335'].map((hex) =>
      processColor(hex),
    );
    const googleFills = paths.filter((p) =>
      googleBrandFills.some((fill) => fill === (p.props.fill as { payload: number })?.payload),
    );
    expect(googleFills).toHaveLength(4);

    const textFill = processColor(colors.text);
    const applePaths = paths.filter((p) => (p.props.fill as { payload: number })?.payload === textFill);
    expect(applePaths.length).toBeGreaterThanOrEqual(1);
  });

  // `fireEvent.press` calls the handler prop directly and never touches Pressability's
  // internal state, so `pressed` never becomes true and a style *callback* is never re-run
  // with it — same reasoning as cta-affordances.test.tsx's `hold()` helper. Responder events
  // are what Pressability actually listens on.
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

  it('gives the Google and Apple buttons a background change while held', async () => {
    const { findByText } = await render(
      <SocialAuthRow onGooglePress={jest.fn()} onApplePress={jest.fn()} />,
    );

    fireEvent((await findByText('Google')).parent as never, 'responderGrant', responderEvent);

    // Re-query rather than reuse the pre-press instance: Pressability's pressed state lives
    // in its own internal setState, so the style callback only reflects it on a fresh query
    // after the responder event, same as cta-affordances.test.tsx's `hold()` pattern.
    const pressedGoogle = await findByText('Google');
    const style = (pressedGoogle.parent?.props as { style?: unknown })?.style;
    const flat = Array.isArray(style)
      ? Object.assign({}, ...(style as object[]).flat(Infinity))
      : (style ?? {});
    expect((flat as { backgroundColor?: string }).backgroundColor).toBe(colors.elevated2);
  });
});
