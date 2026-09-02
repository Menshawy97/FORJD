import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * Home's readiness card. Every value it shows comes from a wearable, which means Health
 * Connect / HealthKit -- Phase 6. Nothing in this repo can compute a readiness score today.
 *
 * So the card is built at full fidelity and left honestly empty: the ring draws its track
 * with no progress arc, the score is an em dash, and the three chips name their metrics with
 * no readings behind them. The design's 87 / "Good" / "HRV stable" are demo data, and
 * printing them would be inventing health numbers for a user -- the worst possible thing to
 * fabricate. When Phase 6 lands, this file takes a `readiness` prop and the em dashes become
 * values; the layout does not move.
 */
const RING_SIZE = 78;
const RING_RADIUS = 34;
const RING_STROKE = 7;

const EMPTY = '—';

/**
 * The design's chips read "HRV stable" / "Sleep 7h 42m" / "RHR normal" -- a metric name and
 * its reading. With no reading, each chip keeps its name and carries an em dash in the slot
 * the value will occupy, which also keeps these strings distinct from the stat strip's own
 * "HRV" / "Sleep" / "RHR" metric labels further down the screen.
 */
const CHIPS = ['HRV —', 'Sleep —', 'RHR —'] as const;

export function ReadinessCard() {
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
            {CHIPS.map((chip) => (
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
            </Svg>
            <View className="absolute inset-0 items-center justify-center">
              <Text
                className="font-archivo text-readiness-score font-bold text-green"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {EMPTY}
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
            <Text className="font-archivo text-readiness-value font-bold text-text">{EMPTY}</Text>
            <Text className="mt-[6px] text-right font-archivo text-readiness-body text-readinessBody">
              Connect a wearable to see readiness
            </Text>
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}
