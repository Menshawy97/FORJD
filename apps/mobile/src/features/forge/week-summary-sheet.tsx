import type { ForgeWeekSummary } from '@forjd/contracts';
import { FORGE_LADDER_NAMES, FORGE_LADDER_UNITS } from '@forjd/domain';
import { Pressable, Text, View } from 'react-native';

import { pressScale } from '@/components/press-feedback';
import { ForgeMark } from './forge-mark';
import { outcomeChip, outcomeDetail, weekRangeLabel, type ChipTone } from './forge-copy';

/**
 * The week summary sheet, as approved in the Phase 7 mock-ups (item H), drawn in the app's
 * existing sheet style (`exercise/[id].tsx`, `nutrition-share.tsx`): the scrim, then a sheet with
 * 18 px top corners, a `border` top edge, `surface`, 22 px gutters, 20 px above and 24 px below.
 *
 * - Title "Week of 19 – 25 Sep" (18 px bold), then levels gained and marks earned (13 px `dimmer`).
 * - One row per ladder: 10 px above and below, `borderFaint` rules, a decorative 30 px badge, the
 *   ladder name, the result label (11 px, 7 px corners) and the detail line under it. The row is
 *   one screen-reader stop that says all three.
 * - Done: the app's primary button. `isBusy` disables it while the acknowledgement is on its way,
 *   so a second tap cannot send it again.
 */
interface WeekSummarySheetProps {
  week: ForgeWeekSummary;
  isBusy: boolean;
  onDone: () => void;
}

const CHIP_CLASS: Record<ChipTone, { box: string; text: string }> = {
  up: { box: 'bg-readinessChipBg', text: 'text-readinessChipText' },
  band: { box: 'bg-accentHover', text: 'text-screenBg' },
  hold: { box: 'bg-iconButtonPressedBg', text: 'text-textSecondary' },
};

export function WeekSummarySheet({ week, isBusy, onDone }: WeekSummarySheetProps) {
  return (
    <View className="absolute inset-0 z-20 items-end justify-end bg-scrim" accessibilityViewIsModal>
      <View className="w-full gap-[10px] rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]">
        <Text accessibilityRole="header" className="font-archivo text-[18px] font-bold text-text">
          {`Week of ${weekRangeLabel(week.weekStart)}`}
        </Text>
        <Text className="font-archivo text-[13px] text-dimmer">{earnedLine(week.levelsGained, week.marksEarned)}</Text>

        <View>
          {week.ladders.map((ladder, index) => {
            const name = FORGE_LADDER_NAMES[ladder.ladder];
            const chip = outcomeChip(ladder);
            const detail = outcomeDetail(ladder, FORGE_LADDER_UNITS[ladder.ladder]);
            return (
              <View
                key={ladder.ladder}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${name}: ${chip.label}. ${detail}`}
                className={`flex-row items-center gap-3 py-[10px] ${index === 0 ? '' : 'border-t border-borderFaint'}`}>
                <ForgeMark ladder={ladder.ladder} band={ladder.bandAfter} size={30} decorative />
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-baseline justify-between gap-2">
                    <Text className="font-archivo text-row-title font-semibold text-text">{name}</Text>
                    <View className={`rounded-[7px] px-[7px] py-[5px] ${CHIP_CLASS[chip.tone].box}`}>
                      <Text className={`font-archivo text-[11px] font-semibold ${CHIP_CLASS[chip.tone].text}`}>
                        {chip.label}
                      </Text>
                    </View>
                  </View>
                  <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">{detail}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          accessibilityState={{ disabled: isBusy, busy: isBusy }}
          disabled={isBusy}
          onPress={onDone}
          style={pressScale}
          className="mt-[6px] h-[52px] w-full items-center justify-center rounded-button bg-accentDark shadow-primary-button">
          <Text className="font-archivo text-button font-bold text-white">Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

function earnedLine(levelsGained: number, marksEarned: number): string {
  if (levelsGained === 0 && marksEarned === 0) {
    return 'No levels gained this week';
  }
  const levels = `${levelsGained} ${levelsGained === 1 ? 'level' : 'levels'} gained`;
  const marks = `${marksEarned} ${marksEarned === 1 ? 'mark' : 'marks'} earned`;
  return `${levels} · ${marks}`;
}
