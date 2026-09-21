import { Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * One tile of the live run's 2x2 grid (`s_run()`): card `#17181a` with a hairline, radius 14,
 * padding `14px 15px`. The label sits 10px above a `700 26px` value at `-.02em` with a `500 11.5px`
 * unit 4px beside it. The label and unit greys are the app's contrast-lifted `label` / `dimmer`
 * tokens rather than the prototype's `#77776f` / `#6e6e66`, exactly as the workout summary does.
 */
interface RunMetricTileProps {
  label: string;
  value: string;
  unit: string;
  /** The value's colour; the prototype's white, the accent for pace, `#c9503c` for heart rate. */
  color?: string;
}

export function RunMetricTile({ label, value, unit, color }: RunMetricTileProps) {
  return (
    <View
      className="flex-1 rounded-card px-[15px] py-[14px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Text className="mb-[10px] font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]" style={{ color: colors.label }}>
        {label}
      </Text>
      <View className="flex-row items-baseline" style={{ gap: 4 }}>
        <Text
          className="font-archivo text-[26px] font-bold tracking-[-.02em]"
          style={{ color: color ?? colors.text, fontVariant: ['tabular-nums'] }}
          numberOfLines={1}>
          {value}
        </Text>
        <Text className="font-archivo text-[11.5px] font-medium" style={{ color: colors.dimmer }}>
          {unit}
        </Text>
      </View>
    </View>
  );
}
