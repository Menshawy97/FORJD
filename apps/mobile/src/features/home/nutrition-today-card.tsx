import type { MacroGoalsResponse } from '@forjd/contracts';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ConcentricRings, type RingBand } from '@/nutrition/concentric-rings';
import type { MacroTotals } from '@/nutrition/totals';
import { colors } from '@/theme/tokens';

/**
 * Nutrition Phase I -- the "Nutrition Today" card, the entry point from Home into
 * `nutrition.tsx`. ADR-020 is explicit that nutrition is not a tab: this card is how the
 * feature is reached, which is why the nutrition plan called Home's absence a real blocker.
 *
 * The ring is four nested bands -- calories outermost, then protein, carbs, fat innermost --
 * an Apple-Watch-activity-ring treatment applied consistently across this card, the main
 * nutrition dashboard's ring, and the share card's preview (`concentric-rings.tsx` is the one
 * geometry shared by all three). No text sits inside this particular ring (there wasn't room
 * for it at 52px even with a single ring, and the kcal figure already sits beside it), so the
 * small size here carries no legibility risk the way the two bigger, text-centered rings do.
 *
 * **The no-goals case diverges from the prototype deliberately.** The prototype computes
 * `kcal / macroGoals.kcal` unconditionally because its goals are seeded demo state; a real
 * account may have none. Rather than invent a denominator, the label drops to "<n> kcal" and
 * every ring shows track only -- the same refusal to fabricate a default that `nutrition.tsx`
 * already makes with its "Set your daily goals" card. Goals are all-or-nothing on the wire
 * (`MacroGoalsResponse` carries all four together), so "no goals" is one check, not four.
 */
const RING_SIZE = 52;
const RING_OUTER_RADIUS = 22;
const RING_STROKE = 3;
const RING_GAP = 1.5;

function ratio(value: number, goal: number): number {
  return goal <= 0 ? 0 : Math.min(1, value / goal);
}

interface NutritionTodayCardProps {
  totals: MacroTotals;
  /** Null when the user has not set macro goals -- a normal state, not an error. */
  goals: MacroGoalsResponse | null;
  onPress: () => void;
}

export function NutritionTodayCard({ totals, goals, onPress }: NutritionTodayCardProps) {
  const kcal = Math.round(totals.kcal);

  const bands: RingBand[] = [
    { key: 'calories', color: colors.accent, filled: goals === null ? 0 : ratio(totals.kcal, goals.kcal) },
    { key: 'protein', color: colors.protein, filled: goals === null ? 0 : ratio(totals.protein, goals.protein) },
    { key: 'carbs', color: colors.nutritionCarbs, filled: goals === null ? 0 : ratio(totals.carbs, goals.carbs) },
    { key: 'fat', color: colors.green, filled: goals === null ? 0 : ratio(totals.fat, goals.fat) },
  ];

  const macros = [
    { key: 'protein', color: colors.protein, text: `Protein ${Math.round(totals.protein)}g` },
    { key: 'carbs', color: colors.nutritionCarbs, text: `Carbs ${Math.round(totals.carbs)}g` },
    { key: 'fat', color: colors.green, text: `Fat ${Math.round(totals.fat)}g` },
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Nutrition today"
      onPress={onPress}
      className="my-card-gap flex-row items-center gap-[14px] rounded-hero border border-border bg-surface px-4 py-[14px]">
      <ConcentricRings
        size={RING_SIZE}
        outerRadius={RING_OUTER_RADIUS}
        strokeWidth={RING_STROKE}
        gap={RING_GAP}
        bands={bands}
        trackColor={colors.ringTrack}
      />

      <View className="min-w-0 flex-1">
        <Text className="mb-[6px] font-archivo text-section-label font-semibold uppercase text-label">
          Nutrition today
        </Text>
        <Text
          className="font-archivo text-nutrition-card-value font-bold text-text"
          numberOfLines={1}
          style={{ fontVariant: ['tabular-nums'] }}>
          {goals === null ? `${kcal} kcal` : `${kcal} / ${goals.kcal} kcal`}
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
