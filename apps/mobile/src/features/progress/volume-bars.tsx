import { Text, View } from 'react-native';

import type { WeeklyVolumeDay } from '@forjd/contracts';

/**
 * "Weekly volume (kg)" -- `progress strength.png`'s bar chart. Plain `View`s scaled to
 * height, the same idiom `ThisWeek` already uses for Home's day bars, rather than SVG: the
 * design draws solid rounded bars with no curve or fill gradient, which a `View` already
 * renders exactly, and `react-native-svg` would only add ceremony here.
 *
 * Three-letter day labels ("Mon" through "Sun"), matching the screenshot exactly -- this is a
 * different label set from `WEEK_DAYS`' single letters, which belong to Home's "This week"
 * strip and the training calendar's column heads, not this chart.
 *
 * `days` is Monday-first (`WeeklyVolumeDay.dayOfWeek` is 1-7), so it zips with the label list
 * below by array position with no index conversion to get backwards.
 *
 * A day with no volume draws a 2px stub rather than nothing, matching the design's own Wed/
 * Thu/Sun columns in `progress strength.png` -- a bar of literally zero height would read as a
 * missing column, not a rest day.
 */
interface VolumeBarsProps {
  /** Exactly seven entries, Monday-first, as `progressStrengthResponseSchema` guarantees. */
  days: readonly WeeklyVolumeDay[];
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const CHART_HEIGHT = 92;
const ZERO_DAY_HEIGHT = 2;

export function VolumeBars({ days }: VolumeBarsProps) {
  const maxVolume = Math.max(1, ...days.map((day) => day.volumeKg));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9, height: CHART_HEIGHT }}>
      {DAY_LABELS.map((label, index) => {
        const volumeKg = days[index]?.volumeKg ?? 0;
        const barHeight =
          volumeKg > 0
            ? Math.max(2, Math.round((volumeKg / maxVolume) * CHART_HEIGHT))
            : ZERO_DAY_HEIGHT;

        return (
          <View
            key={label}
            accessible
            accessibilityRole="text"
            accessibilityLabel={
              volumeKg > 0
                ? `${DAY_NAMES[index]}, ${Math.round(volumeKg).toLocaleString()} kilograms lifted`
                : `${DAY_NAMES[index]}, rest`
            }
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
              height: '100%',
            }}>
            <View
              style={{
                width: '82%',
                height: barHeight,
                borderRadius: 5,
                backgroundColor: volumeKg > 0 ? '#E9712F' : '#232427',
              }}
            />
            <Text style={{ fontFamily: 'Archivo', fontSize: 10, fontWeight: '500', color: '#5C5C55' }}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
