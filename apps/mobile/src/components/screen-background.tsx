import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * The ember atmosphere every screen in the prototype is drawn on:
 *
 *   .fj-screen.fj-atm-ember{background:radial-gradient(130% 90% at 50% -10%,
 *                            rgba(233,113,47,.20),#101011 55%)}
 *
 * It is the default rather than a variant — `frameClasses()` reads
 * `this.props.atmosphere ?? 'ember'` — so this wraps screens rather than being opted into.
 *
 * `expo-linear-gradient` has no radial mode, so this is react-native-svg. The CSS translates
 * one-to-one under `gradientUnits="objectBoundingBox"`, where every value is a fraction of
 * the painted box:
 *
 *   at 50% -10%  ->  cx 0.5, cy -0.1   (the centre sits above the top edge)
 *   130% 90%     ->  rx 1.3, ry 0.9
 *   rgba(233,113,47,.20) -> stop 0     accent at 20% opacity
 *   #101011 55%          -> stop 0.55  the solid screen background
 *
 * Past the last stop the gradient pads — it holds `#101011` for the rest of the box, which
 * is what CSS does past its final stop, so the bottom of a tall screen is flat #101011.
 * `spreadMethod` is not passed explicitly: react-native-svg's `RadialGradientProps` does not
 * declare it (only `LinearGradient` does), and pad is the SVG default anyway, so naming it
 * would be a type error in exchange for nothing. The same solid colour is kept on the View
 * beneath so there is never a frame where the SVG has not painted yet.
 */
const GRADIENT_ID = 'forjd-ember';

interface ScreenBackgroundProps {
  children: ReactNode;
  /**
   * Classes for the content layer — the screen's own padding and layout. Applied to an inner
   * container rather than the outer one so the gradient always spans the full screen,
   * including under whatever gutter the screen asks for. A screen swaps its root `<View>`
   * for this component and passes what that View carried, minus the background colour.
   */
  className?: string;
}

export function ScreenBackground({ children, className }: ScreenBackgroundProps) {
  // The prototype opens every screen with a `height:52px; flex:none` status-bar row. 52 is
  // what that row measured in a fixed-size browser mock-up, not a value any real device
  // reports — so the equivalent here is the device's own top inset, which is 0 where there
  // is no notch and ~47-59 where there is. The gradient stays *outside* this padding, so the
  // glow still starts at the very top of the screen rather than below the status bar.
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-screenBg">
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient
            id={GRADIENT_ID}
            cx="0.5"
            cy="-0.1"
            rx="1.3"
            ry="0.9"
            gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={colors.accent} stopOpacity="0.2" />
            <Stop offset="0.55" stopColor={colors.screenBg} stopOpacity="1" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${GRADIENT_ID})`} />
      </Svg>
      <View
        className={className ? `flex-1 ${className}` : 'flex-1'}
        style={{ paddingTop: insets.top }}>
        {children}
      </View>
    </View>
  );
}
