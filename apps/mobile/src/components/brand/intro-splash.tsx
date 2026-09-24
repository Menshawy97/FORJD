import { useEffect, useMemo } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import { BRAND_GRAPHITE } from './brand-paths';
import { LogoMark } from './logo-mark';
import { Wordmark } from './wordmark';

/**
 * Animation #9 "Readiness ring" from the FORJD Logo canvas (ADR-052), shown over the app on
 * every cold start. The canvas loops it every 4.8s; every time below is its keyframe
 * percentage of 4800ms, kept exactly up to the wordmark landing (62% = 2976ms), after which
 * the user chose a short hold and fade instead of the canvas's long hold -- ~3.3s in all.
 *
 *   arc draws          4-36%   cubic-bezier(.6,0,.2,1)
 *   ring fades + 1.12  36-46%  cubic-bezier(.4,0,.2,1)
 *   mark pops .4 -> 1  36-46%  cubic-bezier(.3,1.4,.5,1)
 *   words rise 14px    50-62%  cubic-bezier(.2,.7,.2,1)
 *   fade out           3000-3300ms
 *
 * Built-in Animated, not Reanimated: the root layout is loaded by every route-tree test, where
 * expo-router's testing library replaces Reanimated with an empty module. Opacity and
 * transforms run on the native driver; only the arc's `strokeDashoffset` (an SVG prop) is
 * JS-driven, for its 1.5s.
 */
const CYCLE_MS = 4800;
const at = (percent: number) => (CYCLE_MS * percent) / 100;

const FADE_START_MS = 3000;
export const INTRO_DURATION_MS = 3300;
export const INTRO_REDUCED_MOTION_MS = 800;

const RING_SIZE = 300;
const RING_RADIUS = 140;
const RING_STROKE = 6;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const MARK_SIZE = 140;
const WORDMARK_HEIGHT = 55;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function step(
  value: Animated.Value,
  delay: number,
  duration: number,
  easing: (t: number) => number,
  useNativeDriver = true,
) {
  return Animated.sequence([
    Animated.delay(delay),
    Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver }),
  ]);
}

const range = (value: Animated.Value, from: number, to: number) =>
  value.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

interface IntroSplashProps {
  onDone: () => void;
}

export function IntroSplash({ onDone }: IntroSplashProps) {
  const { arc, ringOut, markIn, wordIn, fadeOut } = useMemo(
    () => ({
      arc: new Animated.Value(0),
      ringOut: new Animated.Value(0),
      markIn: new Animated.Value(0),
      wordIn: new Animated.Value(0),
      fadeOut: new Animated.Value(0),
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | undefined;
    // Armed before asking about reduce motion, not after: the overlay covers the whole app, so
    // its exit must never depend on a native accessibility call settling. If that call hangs,
    // the intro still ends on time (unanimated, but the app is reachable).
    let timer: ReturnType<typeof setTimeout> = setTimeout(onDone, INTRO_DURATION_MS);

    const play = (reduceMotion: boolean) => {
      if (cancelled) return;
      if (reduceMotion) {
        // The finished lockup, no motion, then straight on.
        [arc, ringOut, markIn, wordIn].forEach((value) => value.setValue(1));
        clearTimeout(timer);
        timer = setTimeout(onDone, INTRO_REDUCED_MOTION_MS);
        return;
      }
      animation = Animated.parallel([
        step(arc, at(4), at(32), Easing.bezier(0.6, 0, 0.2, 1), false),
        step(ringOut, at(36), at(10), Easing.bezier(0.4, 0, 0.2, 1)),
        step(markIn, at(36), at(10), Easing.bezier(0.3, 1.4, 0.5, 1)),
        step(wordIn, at(50), at(12), Easing.bezier(0.2, 0.7, 0.2, 1)),
        step(fadeOut, FADE_START_MS, INTRO_DURATION_MS - FADE_START_MS, Easing.linear),
      ]);
      animation.start();
    };

    AccessibilityInfo.isReduceMotionEnabled().then(play, () => play(false));
    return () => {
      cancelled = true;
      animation?.stop();
      clearTimeout(timer);
    };
    // onDone is read once: the intro plays a single time per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // One modal element to a screen reader: the Welcome/Home screen is already mounted beneath,
    // and without this a swipe could land on controls the overlay hides and blocks.
    <Animated.View
      testID="intro-splash"
      accessible
      accessibilityLabel="FORJD"
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, styles.root, { opacity: range(fadeOut, 1, 0) }]}>
      <View style={styles.column}>
        <View style={styles.ringBox}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { opacity: range(ringOut, 1, 0), transform: [{ scale: range(ringOut, 1, 1.12) }] },
            ]}>
            <Svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              style={{ transform: [{ rotate: '-90deg' }] }}>
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke={BRAND_GRAPHITE}
                strokeWidth={RING_STROKE}
              />
              <AnimatedCircle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke={colors.accent}
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={range(arc, CIRCUMFERENCE, 0)}
              />
            </Svg>
          </Animated.View>
          <Animated.View
            style={[
              styles.mark,
              {
                // The canvas's overshooting bezier would push opacity past 1: clamp it, but
                // keep the scale's bounce.
                opacity: markIn.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
                transform: [{ scale: range(markIn, 0.4, 1) }],
              },
            ]}>
            <LogoMark size={MARK_SIZE} />
          </Animated.View>
        </View>
        <Animated.View
          style={[styles.words, { opacity: wordIn, transform: [{ translateY: range(wordIn, 14, 0) }] }]}>
          <Wordmark height={WORDMARK_HEIGHT} />
          <Text style={styles.tagline}>TRAINING. RECOVERY. PROGRESS.</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.screenBg, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  column: { alignItems: 'center', gap: 44 },
  ringBox: { width: RING_SIZE, height: RING_SIZE },
  mark: {
    position: 'absolute',
    left: (RING_SIZE - MARK_SIZE) / 2,
    top: (RING_SIZE - MARK_SIZE) / 2,
    width: MARK_SIZE,
    height: MARK_SIZE,
  },
  words: { alignItems: 'center', gap: 20 },
  // 13px / 500 / .34em in the canvas; RN letterSpacing is in px, so .34 x 13.
  tagline: { fontFamily: 'Archivo', fontSize: 13, fontWeight: '500', letterSpacing: 13 * 0.34, color: '#8C8C91' },
});
