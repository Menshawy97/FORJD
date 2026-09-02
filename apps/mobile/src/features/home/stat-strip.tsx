import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { colors } from '@/theme/tokens';

/**
 * Home's two-row stat block: four lifetime/period counters over four health metrics, with a
 * tooltip strip that opens beneath when a metric is tapped.
 *
 * Neither row has a data source yet. The counters need the workout engine (Phase 3) -- there
 * is no `workout_sessions` table to count -- and City Rank additionally needs the leaderboard
 * behind the Rank tab, itself still a placeholder. The metrics need Health Connect /
 * HealthKit (Phase 6). So the counters read 0 (an honest count of the zero workouts this app
 * can currently record), City Rank reads an em dash (unknown, not zeroth), and the metrics
 * read em dashes.
 *
 * The tooltips are the exception: their copy explains what the metric *is*, so it is correct
 * with or without a reading behind it, and it ships now rather than waiting for Phase 6. The
 * prototype opens them on hover and toggles them on click; a phone has no hover, so tap is
 * the only interaction here.
 */
interface Metric {
  key: string;
  label: string;
  icon: IconName;
  /** Green in the design for the two recovery metrics, plain text for the other two. */
  accented: boolean;
  tooltip: string;
}

const METRICS: readonly Metric[] = [
  {
    key: 'sleep',
    label: 'Sleep',
    icon: 'moon',
    accented: true,
    tooltip: 'Total time asleep last night, from your connected wearable.',
  },
  {
    key: 'hrv',
    label: 'HRV',
    icon: 'heart',
    accented: true,
    tooltip: 'Heart rate variability — higher usually means better-recovered.',
  },
  {
    key: 'rhr',
    label: 'RHR',
    icon: 'pulse',
    accented: false,
    tooltip: 'Your heart rate at rest, measured overnight.',
  },
  {
    key: 'steps',
    label: 'Steps',
    icon: 'bars',
    accented: false,
    tooltip: 'Steps counted so far today.',
  },
];

const COUNTERS: ReadonlyArray<{ key: string; label: string; value: string; unit?: string }> = [
  { key: 'workouts', label: 'Workouts', value: '0' },
  { key: 'month', label: 'This Month', value: '0' },
  // Unknown rather than zero: "#0" would be a rank, and a wrong one.
  { key: 'rank', label: 'City Rank', value: '—' },
  { key: 'streak', label: 'Streak', value: '0', unit: 'wk' },
];

const EMPTY = '—';

export function StatStrip() {
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const tip = METRICS.find((metric) => metric.key === openMetric) ?? null;

  return (
    <View className="my-card-gap overflow-hidden rounded-hero border border-border bg-surface">
      <View className="flex-row">
        {COUNTERS.map((counter, index) => (
          <View
            key={counter.key}
            className={`flex-1 items-center px-2 py-[14px] ${
              index === COUNTERS.length - 1 ? '' : 'border-r border-borderCell'
            }`}>
            <View className="flex-row items-baseline justify-center gap-[3px]">
              <Text
                className="font-archivo text-home-stat-numeral font-bold text-accent"
                style={{ fontVariant: ['tabular-nums'] }}>
                {counter.value}
              </Text>
              {counter.unit === undefined ? null : (
                <Text className="font-archivo text-home-stat-unit font-semibold text-accent">
                  {counter.unit}
                </Text>
              )}
            </View>
            <Text className="mt-[6px] font-archivo text-home-caption font-medium text-dimmer">
              {counter.label}
            </Text>
          </View>
        ))}
      </View>

      <View className="h-px bg-borderCell" />

      <View className="flex-row">
        {METRICS.map((metric, index) => (
          <Pressable
            key={metric.key}
            accessibilityRole="button"
            accessibilityLabel={`${metric.label} metric`}
            // It is a disclosure, so a screen reader has to be told whether the tooltip it
            // toggles is currently open -- the strip appears elsewhere in the tree, where the
            // user may never land.
            accessibilityState={{ expanded: openMetric === metric.key }}
            onPress={() => setOpenMetric((current) => (current === metric.key ? null : metric.key))}
            className={`min-w-0 flex-1 items-center px-3 py-[14px] ${
              index === METRICS.length - 1 ? '' : 'border-r border-borderCell'
            }`}>
            <View className="flex-row items-center justify-center gap-[6px]">
              <Icon name={metric.icon} size={13} color={colors.label} />
              <Text className="font-archivo text-metric-label font-semibold uppercase text-label">
                {metric.label}
              </Text>
            </View>
            <Text
              className={`mt-[7px] font-archivo text-home-metric-value font-bold ${
                metric.accented ? 'text-green' : 'text-text'
              }`}
              numberOfLines={1}
              style={{ fontVariant: ['tabular-nums'] }}>
              {EMPTY}
            </Text>
          </Pressable>
        ))}
      </View>

      {tip === null ? null : (
        <View className="border-t border-borderCell bg-tooltipStripBg px-[14px] py-[11px]">
          <Text className="font-archivo text-tooltip text-tooltipBody">
            <Text className="font-semibold text-accent">{tip.label}</Text>
            {` — ${tip.tooltip}`}
          </Text>
        </View>
      )}
    </View>
  );
}
