import { Pressable, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Icon } from '@/components/icon';
import type { MacroTotals } from '@/nutrition/totals';
import { colors } from '@/theme/tokens';

/**
 * Nutrition Phase I -- the "Nutrition Today" card, the entry point from Home into
 * `nutrition.tsx`. ADR-020 is explicit that nutrition is not a tab: this card is how the
 * feature is reached, which is why the nutrition plan called Home's absence a real blocker.
 *
 * Ring geometry is the prototype's: 52px box, r=22, 6px stroke, rotated -90deg so it fills
 * clockwise from twelve o'clock.
 *
 * **The no-goals case diverges from the prototype deliberately.** The prototype computes
 * `kcal / macroGoals.kcal` unconditionally because its goals are seeded demo state; a real
 * account may have none. Rather than invent a denominator, the label drops to "<n> kcal" and
 * the ring shows track only -- the same refusal to fabricate a default that `nutrition.tsx`
 * already makes with its "Set your daily goals" card.
 */
const RING_SIZE = 52;
const RING_RADIUS = 22;
const RING_STROKE = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface NutritionTodayCardProps {
  totals: MacroTotals;
  /** Null when the user has not set macro goals -- a normal state, not an error. */
  goalKcal: number | null;
  onPress: () => void;
}

export function NutritionTodayCard({ totals, goalKcal, onPress }: NutritionTodayCardProps) {
  const kcal = Math.round(totals.kcal);
  // Capped at 1 so eating over the target fills the ring rather than winding it a second time.
  const filled = goalKcal === null || goalKcal <= 0 ? 0 : Math.min(1, totals.kcal / goalKcal);

  const macros = [
    { key: 'protein', color: colors.accent, text: `Protein ${Math.round(totals.protein)}g` },
    { key: 'carbs', color: colors.nutritionCarbs, text: `Carbs ${Math.round(totals.carbs)}g` },
    { key: 'fat', color: colors.green, text: `Fat ${Math.round(totals.fat)}g` },
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Nutrition today"
      onPress={onPress}
      className="my-card-gap flex-row items-center gap-[14px] rounded-hero border border-border bg-surface px-4 py-[14px]">
      <View style={{ width: RING_SIZE, height: RING_SIZE }}>
        <View style={{ width: RING_SIZE, height: RING_SIZE, transform: [{ rotate: '-90deg' }] }}>
          <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={colors.ringTrack}
              strokeWidth={RING_STROKE}
            />
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={colors.accent}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${RING_CIRCUMFERENCE}`}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - filled)}
            />
          </Svg>
        </View>
      </View>

      <View className="min-w-0 flex-1">
        <Text className="mb-[6px] font-archivo text-section-label font-semibold uppercase text-label">
          Nutrition today
        </Text>
        <Text
          className="font-archivo text-nutrition-card-value font-bold text-text"
          numberOfLines={1}
          style={{ fontVariant: ['tabular-nums'] }}>
          {goalKcal === null ? `${kcal} kcal` : `${kcal} / ${goalKcal} kcal`}
        </Text>
        <View className="mt-[6px] flex-row gap-[10px]">
          {macros.map((macro) => (
            <View key={macro.key} className="flex-row items-center gap-1">
              <View
                className="h-[6px] w-[6px] rounded-pill"
                style={{ backgroundColor: macro.color }}
              />
              <Text className="font-archivo text-home-caption font-medium text-dim" numberOfLines={1}>
                {macro.text}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <Icon name="chevron" size={16} color={colors.metadata} />
    </Pressable>
  );
}
