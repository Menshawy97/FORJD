import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

import { colors } from '@/theme/tokens';

// The prototype's `fj-spin .7s linear infinite` keyframe animation, used by s_connect()'s
// per-source busy indicator while a connection is in flight -- the first (and so far only)
// spinning-ring element in the app, so there is no existing component to reuse.
//
// Built on the built-in `Animated` API, not Reanimated: this is a single always-present
// rotation with no gesture or shared-value interplay, so the simpler API is enough, and it
// keeps the transform array unconditionally present (never `undefined`) per the app's own
// RN-Fabric-crash lesson around conditional `transform` keys.
interface SpinnerProps {
  size?: number;
}

const DEFAULT_SIZE = 18;
const SPIN_DURATION_MS = 700;

export function Spinner({ size = DEFAULT_SIZE }: SpinnerProps) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: SPIN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: 'rgba(233,113,47,.25)',
        borderTopColor: colors.accent,
        transform: [{ rotate }],
      }}
    />
  );
}
