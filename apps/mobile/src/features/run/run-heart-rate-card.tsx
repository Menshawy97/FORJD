import { Text, View } from 'react-native';

import { Sparkline } from '@/components/sparkline';
import { colors } from '@/theme/tokens';

/**
 * The live run's heart-rate card (`s_run()`): card `#17181a`, padding `14px 15px`, 12px above it. A
 * label, `"<bpm> bpm now"` in `700 13px` `#c9503c`, then a 300x54 filled sparkline 12px below.
 *
 * **Without a watch there is no line and the figure is a dash** (R2): the prototype's series is
 * simulated, and inventing a person's heart rate is not acceptable (Phase J). The card keeps its
 * height so the screen does not jump when a watch starts feeding it.
 */
const CHART_HEIGHT = 54;

interface RunHeartRateCardProps {
  currentBpm: number | null;
  /** Recent samples, oldest first. */
  series: readonly number[];
}

export function RunHeartRateCard({ currentBpm, series }: RunHeartRateCardProps) {
  return (
    <View
      className="mt-[12px] rounded-card px-[15px] py-[14px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <View className="mb-[12px] flex-row items-center justify-between">
        <Text className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]" style={{ color: colors.label }}>
          Heart rate
        </Text>
        <Text
          className="font-archivo text-[13px] font-bold"
          style={{ color: colors.destructive, fontVariant: ['tabular-nums'] }}>
          {currentBpm === null ? '— bpm now' : `${currentBpm} bpm now`}
        </Text>
      </View>
      <View style={{ height: CHART_HEIGHT }}>
        <Sparkline points={series} width={300} height={CHART_HEIGHT} color={colors.destructive} />
      </View>
    </View>
  );
}
