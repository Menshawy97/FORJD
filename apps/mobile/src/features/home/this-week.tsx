import { Text, View } from 'react-native';

import { WEEK_DAYS } from './date';

/**
 * Home's "This week" strip: a session count, a progress rail, and seven day bars.
 *
 * Sessions are the workout engine's data (Phase 3), so the count is 0, the rail is empty and
 * every bar is in the rest-day fill. The design's three bar states (trained, partial, rest)
 * collapse to one until there is something to distinguish -- the accent fills arrive with the
 * session data that decides which days get them.
 *
 * The whole block is tappable in the prototype (`goWeekly`), but `weekly` is not a route in
 * this app, so it renders as plain content for now rather than a control that does nothing.
 *
 * Each bar carries an accessibility label naming its day, because the visible letters alone
 * are ambiguous by design: Tuesday and Thursday are both "T", Saturday and Sunday both "S".
 */
export function ThisWeek() {
  const todayIndex = new Date().getDay();

  return (
    <View>
      <View className="mb-[9px] mt-5 flex-row items-baseline justify-between">
        <Text className="font-archivo text-section-label font-semibold uppercase text-label">
          This week
        </Text>
        <Text
          className="font-archivo text-week-count font-semibold text-accent"
          style={{ fontVariant: ['tabular-nums'] }}>
          0 sessions
        </Text>
      </View>

      <View className="mb-3 h-[3px] overflow-hidden rounded-[2px] bg-weekRailTrack" />

      <View className="flex-row gap-[7px]">
        {WEEK_DAYS.map((day) => (
          // The label and `accessible` live on the column, not on the bar inside it. A bare
          // `View` defaults to `accessible={false}`, so a label on it is ignored and a screen
          // reader reads the child `Text` instead -- announcing "T" or "S", the exact
          // ambiguity the label exists to remove. Marking the column accessible collapses its
          // subtree into one node, the same technique `components/toggle-row.tsx` documents.
          <View
            key={day.name}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`No session on ${day.name}`}
            className="flex-1 items-center gap-[7px]">
            <View className="h-[26px] w-full rounded-[5px] bg-tagBg" />
            <Text
              className={`font-archivo text-home-caption font-medium ${
                day.dayIndex === todayIndex ? 'text-dim' : 'text-restDayLetter'
              }`}>
              {day.letter}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
