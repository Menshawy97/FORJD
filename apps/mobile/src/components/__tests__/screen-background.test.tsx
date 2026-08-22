// RED first: every screen in the prototype is drawn on an ember radial gradient, and no
// screen in the app was.
//
//   .fj-screen.fj-atm-ember{background:radial-gradient(130% 90% at 50% -10%,
//                            rgba(233,113,47,.20),#101011 55%)}
//
// It is the default, not an option: `frameClasses()` reads `this.props.atmosphere ?? 'ember'`,
// so every screen the prototype renders carries it. An orange glow entering from above the
// top edge, gone by 55% of the way down.
//
// `expo-linear-gradient` cannot express a radial, so this is react-native-svg. The CSS
// maps onto `gradientUnits="objectBoundingBox"` — fractions of the painted box — as
// cx .5 / cy -.1 (the "at 50% -10%") and rx 1.3 / ry .9 (the "130% 90%" extent).
//
// The stop colours are asserted; the *visual* result is not verifiable in Jest, since
// nothing here rasterises. What is verifiable, and what protects the design, is that the
// right primitive is mounted with the right numbers.
import { render } from '@testing-library/react-native';
import { processColor, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

import { ScreenBackground } from '../screen-background';
import { colors } from '@/theme/tokens';

// `ScreenBackground` reads the device inset, and `useSafeAreaInsets()` throws outright when
// no provider is above it. That is the right behaviour — the app root always has one, and a
// silent fallback would hide a real misconfiguration — so these tests supply one too.
// `initialMetrics` gives it a synchronous frame rather than waiting on a native measurement
// that never arrives under Jest.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderScreen(children: ReactNode) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>);
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

describe('ScreenBackground', () => {
  it('renders its children', async () => {
    const { findByText } = await renderScreen(
      <ScreenBackground>
        <Text>content</Text>
      </ScreenBackground>,
    );

    await findByText('content');
  });

  it('paints an ember radial gradient with the prototype geometry', async () => {
    const { toJSON, findByText } = await renderScreen(
      <ScreenBackground>
        <Text>content</Text>
      </ScreenBackground>,
    );
    await findByText('content');

    const gradients = flatten(toJSON()).filter((node) => node.type === 'RNSVGRadialGradient');
    expect(gradients).toHaveLength(1);

    // react-native-svg keeps these as the strings/numbers they were given.
    expect(gradients[0].props).toMatchObject({
      cx: '0.5',
      cy: '-0.1',
      rx: '1.3',
      ry: '0.9',
    });
  });

  it('runs from 20% accent to solid screen background at 55%', async () => {
    const { toJSON, findByText } = await renderScreen(
      <ScreenBackground>
        <Text>content</Text>
      </ScreenBackground>,
    );
    await findByText('content');

    const gradient = flatten(toJSON()).find((node) => node.type === 'RNSVGRadialGradient');

    // react-native-svg does not keep <Stop> as host nodes: it flattens them onto the
    // gradient as a packed [offset, colour, offset, colour] array, where each colour is
    // `processColor`'s integer with the stop opacity already folded into its alpha. So the
    // expectation is built the same way rather than transcribing the integers, which would
    // be unreadable and would say nothing about which colour they are.
    // `| 0` reinterprets as a signed 32-bit int. `processColor` returns an opaque colour as
    // an unsigned value while react-native-svg emits the signed one; the bits are identical,
    // and normalising is more honest than writing the signed literal down.
    const packed = (color: string) => (processColor(color) as number) | 0;

    expect(gradient?.props.gradient).toEqual([
      0,
      packed('rgba(233,113,47,0.2)'),
      0.55,
      packed(colors.screenBg),
    ]);

    // 0 is `objectBoundingBox` — every coordinate above is a fraction of the painted box,
    // which is what makes the CSS percentages translate directly.
    expect(gradient?.props.gradientUnits).toBe(0);
  });

  it('sits behind the content on the solid screen background', async () => {
    const { toJSON, findByText } = await renderScreen(
      <ScreenBackground>
        <Text>content</Text>
      </ScreenBackground>,
    );
    await findByText('content');

    // #101011 (`screenBg`), not #08090A (`bg`). The handoff annotates the latter as "the
    // desk, not the screen" — it is the page behind the phone frame, and no screen in the
    // app should be painted with it.
    // The outermost node carrying a className — the SafeAreaProvider above it in the test
    // harness has none, so this is ScreenBackground's own container.
    const root = flatten(toJSON()).find((node) => node.props.className !== undefined);
    expect(String(root?.props.className)).toContain('bg-screenBg');
    expect(String(root?.props.className)).not.toContain('bg-bg');
  });
});
