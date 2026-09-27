import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the phone asks for reduced motion, followed live. Weekly Forge's celebrations use it to
 * show their finished frame instead of animating (the approved reduce-motion versions). Until the
 * setting is read, and if it cannot be read, motion is assumed to be fine, the same default
 * `components/brand/intro-splash.tsx` takes.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (active) {
          setReduceMotion(enabled);
        }
      },
      () => undefined,
    );
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
