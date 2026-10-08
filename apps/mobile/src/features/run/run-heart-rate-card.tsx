import { Text, View } from 'react-native';

import { Sparkline } from '@/components/sparkline';
import { colors } from '@/theme/tokens';

import { HealthAccessNote } from './health-access-note';

/**
 * The live run's heart-rate card (`s_run()`): card `#17181a`, padding `14px 15px`, 12px above it. A
 * label, `"<bpm> bpm now"` in `700 13px` `#c9503c`, then a 300x54 filled sparkline 12px below.
 *
 * **Without a watch there is no line and the figure is a dash** (R2): the prototype's series is
 * simulated, and inventing a person's heart rate is not acceptable (Phase J). The card keeps its
 * height so the screen does not jump when a watch starts feeding it.
 *
 * **When Health Connect has refused heart rate** (access turned off after it was allowed), the chart
 * gives way to a short note with a link to Health Connect's settings, in the same height, so it never
 * reads as a watch that has not synced yet. Replica approved 2026-10-09.
 */
const CHART_HEIGHT = 54;

interface RunHeartRateCardProps {
  currentBpm: number | null;
  /** Recent samples, oldest first. */
  series: readonly number[];
  /** Health Connect refused the heart-rate read: say so instead of drawing an empty chart. */
  isBlocked?: boolean;
}

export function RunHeartRateCard({ currentBpm, series, isBlocked = false }: RunHeartRateCardProps) {
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
      <View className="min-h-[54px] justify-center">
        {isBlocked ? (
          <HealthAccessNote metric="heart_rate" />
        ) : (
          <Sparkline points={series} width={300} height={CHART_HEIGHT} color={colors.destructive} />
        )}
      </View>
    </View>
  );
}
