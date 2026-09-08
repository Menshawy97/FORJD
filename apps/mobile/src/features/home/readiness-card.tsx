import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { ReadinessResponse } from '@forjd/contracts';

import { formatSleepMinutes } from '@/features/health/health-metrics';
import { colors } from '@/theme/tokens';

/**
 * Home's readiness card. Real as of Phase 6's light-up-the-UI slice, once `readiness` (from
 * `GET /health-data/readiness`, ADR-031's methodology) has a real score -- the ring draws a
 * genuine progress arc, the score is the real composite, and the three chips show the
 * athlete's own real recent readings. Every value stays honestly empty (ring track-only, em
 * dashes, no chip readings) until `computeReadiness` has enough history to score, exactly the
 * design decision this file's docblock originally recorded for the pre-Phase-6 state.
 *
 * **Ring reveal animation**, per the prototype's own CSS (`FORJD Mobile.dc.html`'s
 * `@keyframes fj-grow`, applied to this exact circle via `animation:fj-grow .8s ease-out`) and
 * confirmed live in the app: the arc fills in from empty to the real score every time this
 * card comes into view, not only on first app load -- `useFocusEffect` (the same hook Home's
 * own data-reload already uses) is what makes it replay on every return to the tab, since
 * Expo Router keeps tab screens mounted across a tab switch rather than remounting them.
 *
 * `readiness === null` (the request has not resolved, or failed) renders identically to
 * `readiness.score === null` (resolved, but withheld for too little history) -- both are
 * "nothing to show yet," and the caller does not need to distinguish them here.
 */
const RING_SIZE = 78;
const RING_RADIUS = 34;
const RING_STROKE = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** The prototype's own `fj-grow` duration -- `animation:fj-grow .8s ease-out`. */
const RING_ANIMATION_MS = 800;

const EMPTY = '—';

const ZONE_LABEL: Record<'red' | 'yellow' | 'green', string> = {
  red: 'Low',
  yellow: 'Fair',
  green: 'Good',
};

/**
 * Grounded in the same evidence `packages/domain/src/readiness.ts` itself cites (Plews et al.
 * 2013's HRV-guided-training recommendation to ease off after a meaningful baseline decline)
 * -- not a separate invented copy bank. Deliberately short: this card has no room for the
 * fuller sentence `HealthView`'s own FORJD Insight card gives.
 */
const ZONE_BODY: Record<'red' | 'yellow' | 'green', string> = {
  red: 'Recovery is below your normal range today -- consider an easier session.',
  yellow: 'Recovery is average today.',
  green: 'Ready to train hard.',
};

interface ReadinessCardProps {
  readiness: ReadinessResponse | null;
}

function chipText(label: string, key: 'hrv' | 'sleep_duration' | 'resting_heart_rate', readiness: ReadinessResponse | null): string {
  const component = readiness?.components.find((c) => c.key === key);
  if (!component || component.recentValue === null) return `${label} ${EMPTY}`;

  if (key === 'sleep_duration') return `${label} ${formatSleepMinutes(component.recentValue)}`;
  const unit = key === 'hrv' ? 'ms' : 'bpm';
  return `${label} ${Math.round(component.recentValue)}${unit}`;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ReadinessCard({ readiness }: ReadinessCardProps) {
  const score = readiness?.score ?? null;
  const zone = readiness?.zone ?? null;

  // Starts at the "empty" dash-offset (the full circumference, i.e. no arc drawn) and animates
  // toward the real score's offset every time the screen refocuses -- not toward a plain
  // 0-1 progress fraction, since the stroke itself is expressed in dash-offset units.
  const dashOffset = useRef(new Animated.Value(RING_CIRCUMFERENCE)).current;

  useFocusEffect(
    useCallback(() => {
      if (score === null) {
        dashOffset.setValue(RING_CIRCUMFERENCE);
        return;
      }
      dashOffset.setValue(RING_CIRCUMFERENCE);
      Animated.timing(dashOffset, {
        toValue: RING_CIRCUMFERENCE * (1 - score / 100),
        duration: RING_ANIMATION_MS,
        // SVG stroke-dashoffset is not a transform/opacity property, so it cannot run on the
        // native UI thread -- useNativeDriver must stay false for this animated prop.
        useNativeDriver: false,
      }).start();
    }, [dashOffset, score]),
  );

  const chips: readonly string[] = [
    chipText('HRV', 'hrv', readiness),
    chipText('Sleep', 'sleep_duration', readiness),
    chipText('RHR', 'resting_heart_rate', readiness),
  ];

  return (
    <LinearGradient
      // `linear-gradient(160deg, ...)`: 160deg in CSS points down-and-slightly-left, which is
      // this start/end pair in expo-linear-gradient's unit-square coordinates.
      //
      // `LinearGradient` does not reliably take a NativeWind `className` -- `GoProBanner`
      // (profile.tsx) and nutrition-share.tsx's background gradients both instead give the
      // gradient itself a raw `style` for the border radius (needed so the gradient's own
      // pixel fill clips to rounded corners) and put padding/border/inner content on a
      // nested `View` with `className`. Putting the classes directly on `LinearGradient`, as
      // this file first did, silently dropped the rounding and padding -- the gradient
      // painted square corners under a border that had nowhere consistent to sit, and the
      // card's size came from its children's bare layout rather than the design's padding.
      colors={[colors.readinessCardFrom, colors.readinessCardTo]}
      start={{ x: 0.17, y: 0 }}
      end={{ x: 0.83, y: 1 }}
      style={{ borderRadius: 16 }}
    >
      <View className="rounded-hero border border-borderReadiness px-[17px] pb-[18px] pt-4">
        <View className="flex-row items-center gap-[10px]">
          <View className="min-w-0 flex-1 gap-[6px]">
            {chips.map((chip) => (
              <View
                key={chip}
                className="flex-row items-center gap-[5px] self-start rounded-pill bg-readinessChipBg px-[9px] py-[5px]"
              >
                <View className="h-[5px] w-[5px] rounded-pill bg-green" />
                <Text
                  className="font-archivo text-home-caption font-semibold text-readinessChipText"
                  numberOfLines={1}
                >
                  {chip}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ width: RING_SIZE, height: RING_SIZE }}>
            <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke={colors.ringTrack}
                strokeWidth={RING_STROKE}
              />
              {score === null ? null : (
                <AnimatedCircle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={colors.green}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                  // Starts the arc at 12 o'clock instead of SVG's default 3 o'clock, and draws
                  // clockwise -- rotating the whole circle around its own center, not the SVG
                  // canvas, so RING_SIZE/2 is the correct pivot regardless of stroke width.
                  transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                />
              )}
            </Svg>
            <View className="absolute inset-0 items-center justify-center">
              <Text
                className="font-archivo text-readiness-score font-bold text-green"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {score === null ? EMPTY : score}
              </Text>
              <Text className="mt-[2px] font-archivo text-readiness-ring-label font-semibold uppercase text-readinessLabel">
                Ready
              </Text>
            </View>
          </View>

          <View className="min-w-0 flex-1 items-end">
            <Text className="mb-2 font-archivo text-section-label font-semibold uppercase text-readinessLabel">
              Readiness
            </Text>
            <Text className="font-archivo text-readiness-value font-bold text-text">
              {zone === null ? EMPTY : ZONE_LABEL[zone]}
            </Text>
            <Text className="mt-[6px] text-right font-archivo text-readiness-body text-readinessBody">
              {zone === null ? 'Connect a wearable to see readiness' : ZONE_BODY[zone]}
            </Text>
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}
