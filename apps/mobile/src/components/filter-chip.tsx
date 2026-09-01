import { Pressable, Text } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * The solid-fill selection chip used by `food-search.tsx`'s category row and the custom-food
 * sheet's category picker, and `food/[id].tsx`'s "Log as" row -- confirmed against the real
 * screenshots (`FORJD mobile app design/screenshots/searchfoodalsoaddfood.png` and
 * `fooddetails.png`) after this file initially used the app's other, translucent chip style
 * (`colors.pickRowSelectedBg` fill + `colors.accent` text, still correct wherever it was already
 * used, e.g. `nutrition.tsx`'s log-meal sheet). This one is distinct: selected is a solid
 * `colors.accent` fill with bold white text; unselected is a dark `colors.surface` filled pill
 * with `colors.textSecondary` text, never transparent/outlined.
 */
interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="rounded-full border px-[14px] py-2"
      style={{
        backgroundColor: selected ? colors.accent : colors.surface,
        borderColor: selected ? colors.accent : colors.border,
      }}>
      <Text
        className="font-archivo text-[12.5px] font-bold"
        style={{ color: selected ? '#FFFFFF' : colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}
