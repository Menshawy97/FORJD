import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * The 200 px progress ring both `s_rest()` and `s_setTimer()` draw, shared because the two
 * screens draw it identically -- same 200x200 box, same `r=86`, same 8 px stroke, same
 * `rotate(-90)` so the arc starts at twelve o'clock, same `#1e1f22` track under the accent arc.
 *
 * Extracted rather than duplicated: the prototype repeats the markup in both screens, but a
 * ring drawn two slightly different ways in the same flow is exactly the kind of drift a device
 * walk catches late and expensively.
 *
 * R21 (H15): `progress` now only changes once a second -- the screens driving this ring moved
 * their countdown `setState` from 250ms to 1Hz, matching `live.tsx`'s elapsed clock, so the JS
 * thread stops re-rendering (and re-laying-out this SVG) four times a second. The arc's own
 * sub-second sweep is kept smooth anyway by animating a Reanimated shared value toward each new
 * `progress` over the same one-second window, entirely on the UI thread -- the number the
 * athlete reads jumps once a second, same as before, but the ring never visibly stalls between
 * ticks.
 */
const SIZE = 200;
const RADIUS = 86;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TICK_DURATION_MS = 1000;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface CountdownRingProps {
  /** 0..1 of the ring still to run. */
  progress: number;
  /** The large centred figure, already formatted (`1:30`). */
  label: string;
  /** The quiet line beneath it (`until next set`, `hold the position`, `paused`). */
  caption: string;
}

export function CountdownRing({ progress, label, caption }: CountdownRingProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const progressValue = useSharedValue(clamped);

  useEffect(() => {
    progressValue.value = withTiming(clamped, { duration: TICK_DURATION_MS, easing: Easing.linear });
  }, [clamped, progressValue]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progressValue.value),
  }));

  return (
    <View accessibilityLiveRegion="polite" style={{ width: SIZE, height: SIZE }}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={100} cy={100} r={RADIUS} fill="none" stroke="#1E1F22" strokeWidth={8} />
        <AnimatedCircle
          cx={100}
          cy={100}
          r={RADIUS}
          fill="none"
          stroke={colors.accent}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          animatedProps={animatedProps}
        />
      </Svg>
      <View className="absolute inset-0 items-center justify-center">
        <Text className="font-archivo text-[46px] font-bold text-text">{label}</Text>
        <Text className="mt-[8px] font-archivo text-[11.5px] font-medium text-dimmer">{caption}</Text>
      </View>
    </View>
  );
}
