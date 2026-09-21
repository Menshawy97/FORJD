import { Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

import type { GpsQuality } from './gps-quality';

/**
 * The pill in the top-right of the live run's map, from `s_run()` (`live run 1.png`): 6px dot, 6px
 * gap, `6px 10px` padding, radius 8 on `rgba(16,16,17,.82)`, label `600 10px` in `#9a9a92`. Placed
 * `right:12, top:11` by the caller.
 *
 * The design draws only the strong state. Weak and searching use the accent and the paused grey for
 * the dot so the colour agrees with the words rather than claiming a signal there is not.
 */
const DOT_COLORS: Record<GpsQuality['level'], string> = {
  strong: colors.green,
  weak: colors.accent,
  searching: '#6E6E66',
};

export function GpsPill({ quality }: { quality: GpsQuality }) {
  return (
    <View
      accessibilityLabel={quality.label}
      className="absolute right-[12px] top-[11px] flex-row items-center rounded-[8px] px-[10px] py-[6px]"
      style={{ backgroundColor: 'rgba(16,16,17,.82)', gap: 6 }}>
      <View className="h-[6px] w-[6px] rounded-[3px]" style={{ backgroundColor: DOT_COLORS[quality.level] }} />
      <Text className="font-archivo text-[10px] font-semibold" style={{ color: colors.dim }}>
        {quality.label}
      </Text>
    </View>
  );
}
