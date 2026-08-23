import type { StyleProp, ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * The press feedback from `05-interactions.md` and the prototype's `btn()`:
 *
 *   primary, active -> transform: scale(.985)
 *   ghost, pressed  -> background rgba(255,255,255,.04); color #f6f5f3 (no active/pressed
 *                      transform rule — slice2-screen-specs.md §1 calls this out explicitly)
 *
 * Written as `Pressable`'s `style` callback rather than as NativeWind classes: `pressed` is
 * runtime state that the className transform has no way to see, and the transform is a real
 * style value either way.
 *
 * `undefined` when idle, deliberately — returning `{ transform: [] }` would set an identity
 * transform on every button in the app for no reason.
 */
const PRESSED_SCALE = 0.985;

interface PressState {
  pressed: boolean;
}

export function pressScale({ pressed }: PressState): StyleProp<ViewStyle> {
  return pressed ? { transform: [{ scale: PRESSED_SCALE }] } : undefined;
}

export function pressGhost({ pressed }: PressState): StyleProp<ViewStyle> {
  return pressed ? { backgroundColor: colors.pressedGhost } : undefined;
}
