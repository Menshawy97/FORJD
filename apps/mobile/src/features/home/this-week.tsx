import { Text, View } from 'react-native';

import { WEEK_DAYS } from './date';

/**
 * Home's "This week" strip: a session count, a progress rail, and seven day bars.
 *
 * **Real as of Phase 3J-c**, from `GET /workouts/sessions/stats`. The server resolves which
 * days were trained in the *device's own* zone, so a late-evening session lands on the day the
 * athlete trained rather than the next one in UTC.
 *
 * Two of the design's three bar states are supplied: trained and rest. "Partial" needs a
 * notion of a planned week to fall short of, which arrives with programs (Phase 3K) -- until
 * then a day is either trained or it is not, and inventing a third state would mean inventing
 * the target it is partial against.
 *
 * The whole block is tappable in the prototype (`goWeekly`), but `weekly` is not a route in
 * this app, so it renders as plain content for now rather than a control that does nothing.
 *
 * Each bar carries an accessibility label naming its day, because the visible letters alone
 * are ambiguous by design: Tuesday and Thursday are both "T", Saturday and Sunday both "S".
 */
export interface ThisWeekProps {
  /** `null` before the request resolves, and after one that failed -- both read as zero. */
  sessionCount: number | null;
  /** Indexed like `Date#getDay()`, so nothing here converts an index and risks reversing it. */
  trainedWeekdays: readonly number[];
}

/** The rail fills against a nominal five-session week, the cadence the design's own copy assumes. */
const NOMINAL_WEEK_SESSIONS = 5;

export function ThisWeek({ sessionCount, trainedWeekdays }: ThisWeekProps) {
  const todayIndex = new Date().getDay();
  const count = sessionCount ?? 0;
  const trained = new Set(trainedWeekdays);
  const railPercent = Math.min(100, (count / NOMINAL_WEEK_SESSIONS) * 100);

  return (
    <View>
      <View className="mb-[9px] mt-5 flex-row items-baseline justify-between">
        <Text className="font-archivo text-section-label font-semibold uppercase text-label">
          This week
        </Text>
        <Text
          className="font-archivo text-week-count font-semibold text-accent"
          style={{ fontVariant: ['tabular-nums'] }}>
          {`${count} ${count === 1 ? 'session' : 'sessions'}`}
        </Text>
      </View>

      <View className="mb-3 h-[3px] overflow-hidden rounded-[2px] bg-weekRailTrack">
        {count > 0 ? (
          <View className="h-[3px] rounded-[2px] bg-accent" style={{ width: `${railPercent}%` }} />
        ) : null}
      </View>

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
            accessibilityLabel={
              trained.has(day.dayIndex) ? `Session on ${day.name}` : `No session on ${day.name}`
            }
            className="flex-1 items-center gap-[7px]">
            <View
              className={`h-[26px] w-full rounded-[5px] ${
                trained.has(day.dayIndex) ? 'bg-accent' : 'bg-tagBg'
              }`}
            />
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
