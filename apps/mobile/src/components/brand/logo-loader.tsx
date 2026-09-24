import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import { PULSE_PIECES } from './brand-paths';

/**
 * Animation #3 "Pulse loader" from the FORJD Logo canvas (ADR-052), used for the app's longer
 * waits. Each of the symbol's four pieces rests at .16 opacity and flashes to 1 in turn:
 * canvas keyframes `0% .16, 18% 1, 55-100% .16` over 1.6s on cubic-bezier(.4,0,.2,1), the
 * pieces starting .18s apart.
 *
 * Each piece is its own absolutely stacked Svg inside an Animated.View so opacity runs on the
 * native driver (SVG element props cannot). Built-in Animated, like `spinner.tsx`: a fixed
 * loop with nothing gesture-driven needs no Reanimated.
 */
const CYCLE_MS = 1600;
const STAGGER_MS = 180;
const REST_OPACITY = 0.16;
const RISE_MS = CYCLE_MS * 0.18;
const FALL_MS = CYCLE_MS * (0.55 - 0.18);
const HOLD_MS = CYCLE_MS - RISE_MS - FALL_MS;
const EASING = Easing.bezier(0.4, 0, 0.2, 1);

interface LogoLoaderProps {
  size?: number;
}

export function LogoLoader({ size = 44 }: LogoLoaderProps) {
  const opacities = useMemo(() => PULSE_PIECES.map(() => new Animated.Value(REST_OPACITY)), []);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => !cancelled && setReduceMotion(enabled),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacities.forEach((value) => value.setValue(1));
      return;
    }
    const pulse = (value: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 1, duration: RISE_MS, easing: EASING, useNativeDriver: true }),
          Animated.timing(value, { toValue: REST_OPACITY, duration: FALL_MS, easing: EASING, useNativeDriver: true }),
          Animated.delay(HOLD_MS),
        ]),
      );
    const animation = Animated.parallel(
      opacities.map((value, index) => Animated.sequence([Animated.delay(index * STAGGER_MS), pulse(value)])),
    );
    animation.start();
    return () => animation.stop();
  }, [opacities, reduceMotion]);

  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading" style={{ width: size, height: size }}>
      {PULSE_PIECES.map((piece, index) => (
        <Animated.View
          key={piece.key}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{ position: 'absolute', top: 0, left: 0, opacity: opacities[index] }}>
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Path fill={colors.accent} d={piece.d} />
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
}
