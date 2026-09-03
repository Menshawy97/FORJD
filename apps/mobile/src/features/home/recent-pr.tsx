import type { WorkoutPersonalRecord } from '@forjd/contracts';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/**
 * Home's "Recent PR" section.
 *
 * **Real as of Phase 3J-c**, from `GET /workouts/sessions/stats`. "Recent" is load-bearing and
 * is not "heaviest ever": the server returns the record whose *achievement* is most recent, so
 * an athlete who set a squat PR last week sees that rather than the heavier deadlift they have
 * held for a year.
 *
 * The empty state is unchanged and still matters -- it is what a new account sees, and what a
 * failed request falls back to. The star tile keeps its accent ground but draws its glyph in
 * `label` rather than the accent while empty, which is the visual difference between "here is
 * your PR" and "here is where your PR will be".
 */
export interface RecentPrProps {
  /**
   * `null` before the request resolves, after one that failed, and before any weighted set.
   *
   * Typed from the contract rather than restated here: a hand-written copy of the shape would
   * keep compiling after the schema changed and drift silently.
   */
  record: WorkoutPersonalRecord | null;
}

export function RecentPr({ record }: RecentPrProps) {
  return (
    <View>
      <Text className="mb-[9px] mt-[22px] font-archivo text-section-label font-semibold uppercase text-label">
        Recent PR
      </Text>
      <View className="flex-row items-center gap-[13px] rounded-card border border-border bg-surface px-[15px] py-[14px]">
        <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-accentTileBg">
          <Icon name="star" size={19} color={record === null ? colors.label : colors.accent} />
        </View>
        <View className="flex-1">
          <Text className="font-archivo text-pr-title font-semibold text-text" numberOfLines={1}>
            {record === null ? 'No PR yet' : record.exerciseName}
          </Text>
          <Text className="mt-[5px] font-archivo text-pr-meta text-dimmer">
            {record === null
              ? 'Finish a workout to set one'
              : `${record.weightKg} kg × ${record.reps}`}
          </Text>
        </View>
      </View>
    </View>
  );
}
