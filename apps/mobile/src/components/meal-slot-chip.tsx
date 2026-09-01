import { Pressable, Text } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * The translucent meal-slot selection chip -- `nutrition.tsx`'s log-meal sheet originally
 * inlined this (selected = `colors.pickRowSelectedBg` fill + `colors.borderPickRowSelected`
 * border + `colors.accent` text; unselected = transparent/`colors.border`/`colors.textSecondary`).
 * Extracted for Phase H (`saved-meals.tsx` needs the identical "log this meal to which slot"
 * sheet) so the second use is a reuse, not a second hand-copied inline block -- the project's
 * own instruction for this sheet ("reuse the existing chip component, don't rebuild it").
 *
 * Deliberately a different visual from `FilterChip` (solid accent fill when selected) -- that
 * one is `food-search.tsx`/`food/[id].tsx`'s category and "Log as" chips, confirmed against the
 * real screenshots as a distinct style. This component keeps the *other*, already-shipped
 * translucent style intact rather than converging the two, since neither screenshot for this
 * sheet ever changed.
 */
interface MealSlotChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function MealSlotChip({ label, selected, onPress }: MealSlotChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="rounded-full border px-[14px] py-2"
      style={{
        backgroundColor: selected ? colors.pickRowSelectedBg : 'transparent',
        borderColor: selected ? colors.borderPickRowSelected : colors.border,
      }}>
      <Text
        className="font-archivo text-[12.5px] font-semibold"
        style={{ color: selected ? colors.accent : colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}
