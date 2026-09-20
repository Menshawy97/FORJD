import { Pressable, Text } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * The metric chips under the your-rank card: the prototype's `chipStyle(on)` --
 * `padding:'8px 15px'`, `borderRadius:9`, `font:'600 12.5px/1 Archivo'`; on: accent fill and
 * border with `#fff` text, off: `#191a1c` fill, the `.07` border and `#9a9a92` text.
 *
 * Not `FilterChip`: that one is a full pill (`rounded-full`, bold) drawn for the food screens.
 * This is a 9px-radius rectangle at semibold, so reusing it would have been close and wrong.
 */
interface RankChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function RankChip({ label, selected, onPress }: RankChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-[9px] border px-[15px] py-[8px] ${
        selected ? 'border-accent bg-accent' : 'border-border bg-elevated'
      }`}>
      <Text
        style={{
          fontFamily: 'Archivo',
          fontSize: 12.5,
          lineHeight: 12.5,
          fontWeight: '600',
          color: selected ? colors.onAccent : colors.dim,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}
