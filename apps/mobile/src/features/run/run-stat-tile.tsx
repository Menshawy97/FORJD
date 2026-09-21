import { Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * The run-complete screen's stat tile, the prototype's `stat()` helper: card `#17181a`, radius 14,
 * padding `13px 14px`, a 9px gap under the label, a `700 25px` figure (`19px` past five characters so
 * a long time does not overflow) at `-.02em`, and a `500 11.5px` unit 4px beside it. The optional
 * `sub` line is `500 11px`, 7px below.
 */
interface RunStatTileProps {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  sub?: string;
}

const LONG_VALUE_CHARS = 5;

export function RunStatTile({ label, value, unit, color, sub }: RunStatTileProps) {
  return (
    <View
      className="min-w-0 flex-1 rounded-card px-[14px] py-[13px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Text className="mb-[9px] font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]" style={{ color: colors.label }}>
        {label}
      </Text>
      <View className="flex-row items-baseline" style={{ gap: 4 }}>
        <Text
          className="font-archivo font-bold tracking-[-.02em]"
          style={{
            color: color ?? colors.text,
            fontSize: value.length > LONG_VALUE_CHARS ? 19 : 25,
            fontVariant: ['tabular-nums'],
          }}
          numberOfLines={1}>
          {value}
        </Text>
        {unit ? (
          <Text className="font-archivo text-[11.5px] font-medium" style={{ color: colors.dimmer }}>
            {unit}
          </Text>
        ) : null}
      </View>
      {sub ? (
        <Text className="mt-[7px] font-archivo text-[11px] font-medium" style={{ color: colors.dimmer }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}
