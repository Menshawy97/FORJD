import { Text, View } from 'react-native';

import type { WeeklyVolumeDay } from '@forjd/contracts';
import { daysSinceWeekStart } from '@forjd/domain';

/**
 * "Weekly volume (kg)" -- `progress strength.png`'s bar chart. Plain `View`s scaled to
 * height, the same idiom `ThisWeek` already uses for Home's day bars, rather than SVG: the
 * design draws solid rounded bars with no curve or fill gradient, which a `View` already
 * renders exactly, and `react-native-svg` would only add ceremony here.
 *
 * Three-letter day labels, as in the screenshot, but Saturday-first ("Sat" through "Fri"): the
 * week runs Saturday to Friday across the app (ADR-056). This is a
 * different label set from `WEEK_DAYS`' single letters, which belong to Home's "This week"
 * strip and the training calendar's column heads, not this chart.
 *
 * `days` arrives in ISO order (`WeeklyVolumeDay.dayOfWeek` is 1 Monday through 7 Sunday), so
 * each bar is placed by its own `dayOfWeek`, never by array position: the label always comes
 * from the day, and the order from `daysSinceWeekStart`.
 *
 * A day with no volume draws a 2px stub rather than nothing, matching the design's own Wed/
 * Thu/Sun columns in `progress strength.png` -- a bar of literally zero height would read as a
 * missing column, not a rest day.
 */
interface VolumeBarsProps {
  /** Exactly seven entries, one per ISO weekday, as `progressStrengthResponseSchema` guarantees. */
  days: readonly WeeklyVolumeDay[];
}

/** Indexed by ISO weekday minus one: 0 is Monday, 6 is Sunday. */
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

/** ISO weekdays (1 Monday to 7 Sunday) in display order, Saturday first. `% 7` maps ISO 7 to 0. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 7].sort(
  (a, b) => daysSinceWeekStart(a % 7) - daysSinceWeekStart(b % 7),
);

const CHART_HEIGHT = 92;
const ZERO_DAY_HEIGHT = 2;

export function VolumeBars({ days }: VolumeBarsProps) {
  const maxVolume = Math.max(1, ...days.map((day) => day.volumeKg));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9, height: CHART_HEIGHT }}>
      {DISPLAY_ORDER.map((isoDay) => {
        const label = DAY_LABELS[isoDay - 1];
        const name = DAY_NAMES[isoDay - 1];
        const volumeKg = days.find((day) => day.dayOfWeek === isoDay)?.volumeKg ?? 0;
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
                ? `${name}, ${Math.round(volumeKg).toLocaleString()} kilograms lifted`
                : `${name}, rest`
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
