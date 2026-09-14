import { Pressable, Text, View } from 'react-native';

import type { MacroGoalsResponse } from '@forjd/contracts';

import { ConcentricRings, type RingBand } from '@/nutrition/concentric-rings';
import { colors } from '@/theme/tokens';

import type { MacroTotals } from '@/nutrition/totals';

/**
 * The top-of-dashboard card from `nutrition.tsx` (`s_nutrition()`): the concentric
 * calorie/macro rings plus the three `MacroBar` rows when goals exist, or the
 * "Set your daily goals" prompt card when they don't. Extracted verbatim -- geometry,
 * ring sizing, and the goals-gate are unchanged from the screen this was pulled out of.
 */

// Sized larger than the single ring this replaced (120px/r52) specifically to protect the
// kcal number centered inside the innermost band: nesting three more rings inward eats into
// that clear space, so the box grows enough (150px/r62, thinner 6px strokes) to leave the
// centered text roughly the room it always had, rather than shrinking around it.
const RING_SIZE = 150;
const RING_OUTER_RADIUS = 62;
const RING_STROKE = 6;
const RING_GAP = 2;

function ratio(value: number, goal: number): number {
  return goal <= 0 ? 0 : Math.min(1, value / goal);
}

interface DaySummaryProps {
  goals: MacroGoalsResponse | null;
  totals: MacroTotals;
  onEditGoals: () => void;
}

export function DaySummary({ goals, totals, onEditGoals }: DaySummaryProps) {
  if (!goals) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onEditGoals}
        className="rounded-card border border-border bg-surface p-[18px]">
        <Text className="font-archivo text-[15px] font-bold text-text">Set your daily goals</Text>
        <Text className="mt-1 font-archivo text-[12.5px] text-dimmer">
          Track calories and macros against a target you choose.
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      className="flex-row items-center rounded-card border border-border bg-surface p-[18px]"
      style={{ gap: 18 }}>
      <ConcentricRings
        size={RING_SIZE}
        outerRadius={RING_OUTER_RADIUS}
        strokeWidth={RING_STROKE}
        gap={RING_GAP}
        trackColor={colors.restRingTrack}
        bands={
          [
            { key: 'calories', color: colors.accent, filled: ratio(totals.kcal, goals.kcal) },
            { key: 'protein', color: colors.protein, filled: ratio(totals.protein, goals.protein) },
            { key: 'carbs', color: colors.nutritionCarbs, filled: ratio(totals.carbs, goals.carbs) },
            { key: 'fat', color: colors.green, filled: ratio(totals.fat, goals.fat) },
          ] satisfies RingBand[]
        }>
        <Text className="font-archivo text-[22px] font-bold text-text" style={{ fontVariant: ['tabular-nums'] }}>
          {Math.round(totals.kcal)}
        </Text>
        <Text className="mt-0.5 font-archivo text-[10px] text-dimmer">{`/ ${goals.kcal} kcal`}</Text>
      </ConcentricRings>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <MacroBar label="Protein" value={totals.protein} goal={goals.protein} color={colors.protein} />
        <MacroBar label="Carbs" value={totals.carbs} goal={goals.carbs} color={colors.nutritionCarbs} />
        <MacroBar label="Fat" value={totals.fat} goal={goals.fat} color={colors.green} />
      </View>
    </View>
  );
}

interface MacroBarProps {
  label: string;
  value: number;
  goal: number;
  color: string;
}

function MacroBar({ label, value, goal, color }: MacroBarProps) {
  const width = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <View style={{ marginTop: 12 }}>
      <View className="flex-row items-center justify-between" style={{ marginBottom: 6 }}>
        <Text className="font-archivo text-[12px] font-semibold text-text">{label}</Text>
        <Text className="font-archivo text-[11.5px] font-medium text-dimmer" style={{ fontVariant: ['tabular-nums'] }}>
          {`${Math.round(value)}g / ${goal}g`}
        </Text>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,.08)' }}>
        <View style={{ width: `${width}%`, height: 6, borderRadius: 4, backgroundColor: color }} />
      </View>
    </View>
  );
}
