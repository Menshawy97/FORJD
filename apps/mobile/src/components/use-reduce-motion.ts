import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the phone asks for reduced motion, followed live. Weekly Forge's celebrations use it to
 * show their finished frame instead of animating (the approved reduce-motion versions).
 *
 * `null` until the phone has answered, so a caller can wait rather than start an animation on a
 * guess and snap it back a frame later (the same reason `components/brand/intro-splash.tsx` asks
 * before it plays). If the setting cannot be read, motion is assumed to be fine.
 */
export function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (active) {
          setReduceMotion(enabled);
        }
      },
      () => {
        if (active) {
          setReduceMotion(false);
        }
      },
    );
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
