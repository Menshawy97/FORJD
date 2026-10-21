/**
 * Production smoke test 2026-10-20: no button reacted to a press on device. NativeWind's css-interop wraps every
 * `Pressable` and spread its `style` prop into the className styles; a style *function* (`pressScale`, `pressGhost`,
 * every `style={({ pressed }) => ...}`) spread to `{}`, so `pressed` never reached it. The fix is a pnpm patch to
 * react-native-css-interop (ADR-070), shared by iOS and Android: the same `.native.js` runtime runs on both.
 *
 * Jest normally skips css-interop's component registration (`wrap-jsx` only loads it outside tests), so the earlier
 * screen tests never saw the bug. This loads it, so `<Pressable>` below renders through the real interop.
 */
import 'react-native-css-interop/dist/runtime/components';

import { render, screen } from '@testing-library/react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { pressGhost, pressScale } from '@/components/press-feedback';
import { colors } from '@/theme/tokens';

function hostStyle(label: string) {
  return StyleSheet.flatten(screen.getByLabelText(label).props.style) ?? {};
}

describe('Pressable style functions through NativeWind', () => {
  it('applies pressScale while pressed', async () => {
    await render(
      <Pressable accessibilityLabel="Primary" testOnly_pressed style={pressScale}>
        <Text>Primary</Text>
      </Pressable>,
    );

    expect(hostStyle('Primary')).toMatchObject({ transform: [{ scale: 0.985 }] });
  });

  it('applies pressGhost while pressed, beside a className', async () => {
    await render(
      <Pressable accessibilityLabel="Ghost" className="rounded-button border" testOnly_pressed style={pressGhost}>
        <Text>Ghost</Text>
      </Pressable>,
    );

    expect(hostStyle('Ghost')).toMatchObject({ backgroundColor: colors.pressedGhost });
  });

  it('adds nothing at rest', async () => {
    await render(
      <Pressable accessibilityLabel="Idle" className="rounded-button" style={pressScale}>
        <Text>Idle</Text>
      </Pressable>,
    );

    expect(hostStyle('Idle').transform).toBeUndefined();
  });

  it('still applies a plain style object', async () => {
    await render(
      <Pressable accessibilityLabel="Plain" style={{ width: 30 }}>
        <Text>Plain</Text>
      </Pressable>,
    );

    expect(hostStyle('Plain')).toMatchObject({ width: 30 });
  });
});
