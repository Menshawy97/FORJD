import { Text, View } from 'react-native';
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
 */
const SIZE = 200;
const RADIUS = 86;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
  return (
    <View style={{ width: SIZE, height: SIZE }}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={100} cy={100} r={RADIUS} fill="none" stroke="#1E1F22" strokeWidth={8} />
        <Circle
          cx={100}
          cy={100}
          r={RADIUS}
          fill="none"
          stroke={colors.accent}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
        />
      </Svg>
      <View className="absolute inset-0 items-center justify-center">
        <Text className="font-archivo text-[46px] font-bold text-text">{label}</Text>
        <Text className="mt-[8px] font-archivo text-[11.5px] font-medium text-dimmer">{caption}</Text>
      </View>
    </View>
  );
}
