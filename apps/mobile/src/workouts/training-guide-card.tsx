import { EXERCISE_GOAL_DISPLAY_NAMES, type ExerciseGoal } from '@forjd/domain';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';
import { GOAL_GUIDE } from '@/workouts/goal-guide';

/**
 * The live workout screen's "How to train this" collapsible card -- extracted from
 * `app/live.tsx` (R23a), geometry unchanged: `margin-bottom:14px`, radius 14, `#17181a`.
 *
 * Presentational only: `guideOpen` and `currentGoal` are owned by the screen, this file just
 * renders the reference table (`GOAL_GUIDE`) against whichever goal is current.
 */
interface TrainingGuideCardProps {
  guideOpen: boolean;
  guideSubtitle: string;
  currentGoal: ExerciseGoal | null;
  onToggle: () => void;
}

export function TrainingGuideCard({ guideOpen, guideSubtitle, currentGoal, onToggle }: TrainingGuideCardProps) {
  return (
    <View
      className="mb-[14px] overflow-hidden rounded-[14px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={guideOpen ? 'Hide how to train this' : 'How to train this'}
        onPress={onToggle}
        className="flex-row items-center px-[15px] py-[13px]"
        style={{ gap: 11 }}>
        <View
          className="h-[30px] w-[30px] items-center justify-center rounded-[9px]"
          style={{ backgroundColor: 'rgba(233,113,47,.13)' }}>
          <Icon name="target" size={17} color={colors.accent} />
        </View>
        <View className="flex-1">
          <Text className="font-archivo text-[13px] font-semibold text-text">How to train this</Text>
          <Text className="mt-[4px] font-archivo text-[11px]" style={{ color: '#6E6E66' }}>
            {guideSubtitle}
          </Text>
        </View>
        <Icon name="chevron" size={16} color="#8B8B83" />
      </Pressable>

      {guideOpen ? (
        <View className="px-[15px] pb-[15px]">
          {GOAL_GUIDE.map((row) => {
            const isCurrent = row.goal === currentGoal;
            return (
              <View
                key={row.goal}
                className="mt-[13px] pt-[13px]"
                style={{
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(255,255,255,.06)',
                  opacity: isCurrent ? 1 : 0.66,
                }}>
                <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                  <View className="flex-row items-center" style={{ gap: 7 }}>
                    <Text
                      className="font-archivo text-[12.5px] font-bold"
                      style={{ color: isCurrent ? colors.accent : '#C8C8C0' }}>
                      {EXERCISE_GOAL_DISPLAY_NAMES[row.goal]}
                    </Text>
                    {isCurrent ? (
                      <View
                        className="rounded-[5px] px-[7px] py-[3px]"
                        style={{ backgroundColor: 'rgba(233,113,47,.16)' }}>
                        <Text className="font-archivo text-[8.5px] font-bold uppercase tracking-[.1em] text-accent">
                          This lift
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#8B8B83' }}>
                    {row.load}
                  </Text>
                </View>
                <View className="mt-[9px] flex-row" style={{ gap: 6 }}>
                  {[row.reps, row.rest].map((pill) => (
                    <View key={pill} className="rounded-[7px] px-[9px] py-[5px]" style={{ backgroundColor: '#1B1C1E' }}>
                      <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#A9A9A1' }}>
                        {pill}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text className="mt-[8px] font-archivo text-[11px]" style={{ color: '#8B8B83' }}>
                  {row.execution}
                </Text>
                <Text className="mt-[5px] font-archivo text-[11.5px] font-semibold" style={{ color: '#E4E2DE' }}>
                  {row.advice}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
