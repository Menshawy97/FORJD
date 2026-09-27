import type { ForgeLadderProgress, ForgeResponse } from '@forjd/contracts';
import { FORGE_BAND_NAMES, FORGE_LADDER_NAMES, FORGE_LADDERS, type ForgeLadder } from '@forjd/domain';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';
import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';
import { BAND_FINISH } from './band-finish';
import { ForgeMark } from './forge-mark';
import { daysLeftLabel, formatForgeAmount, unitLabel } from './forge-format';

/**
 * The Weekly Forge card on Home, exactly as approved in the Phase 7 mock-ups (item C, with the
 * Hallmark badge and Heat colours from "Phase 7 outcome" in docs/product/weekly-forge-plan.md):
 *
 * - a heading row that copies `ThisWeek`'s: the "Weekly Forge" section label, and the days left in
 *   the `week-count` style on the right ("Last day" on Friday);
 * - the app's card (14 radius, `border`, `surface`), one row per ladder split by `borderFaint`
 *   rules: row padding 12/14, gap 12, a 34 px badge, the ladder name (`row-title`), total / target
 *   in 12 px tabular figures, "Band · Level n" (`row-subtitle`, 3 px below), and a 3 px rail on
 *   `weekRailTrack` in the band's light colour, 8 px below;
 * - a met target turns its figures and rail `green`, with a tick.
 *
 * Presentational only: `WeeklyForgeSection` owns the flag, the loading and the stale-answer
 * guards. `forge` is null while the week loads or when it could not be read, and every row then
 * shows a dash, as approved. Not tappable in this phase: the full view is the profile section.
 */
interface WeeklyForgeCardProps {
  forge: ForgeResponse | null;
}

export function WeeklyForgeCard({ forge }: WeeklyForgeCardProps) {
  const byLadder = new Map(forge?.ladders.map((ladder) => [ladder.ladder, ladder]));

  return (
    <View>
      <View className="mb-[9px] mt-5 flex-row items-baseline justify-between">
        <Text className="font-archivo text-section-label font-semibold uppercase text-label">Weekly Forge</Text>
        {forge ? (
          <Text
            maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
            className="font-archivo text-week-count font-semibold text-accent"
            style={{ fontVariant: ['tabular-nums'] }}>
            {daysLeftLabel(forge.daysLeft)}
          </Text>
        ) : null}
      </View>

      <View className="rounded-card border border-border bg-surface">
        {FORGE_LADDERS.map((ladder, index) => {
          const progress = byLadder.get(ladder);
          return progress ? (
            <LadderRow key={ladder} progress={progress} isFirst={index === 0} />
          ) : (
            <PendingRow key={ladder} ladder={ladder} isFirst={index === 0} />
          );
        })}
      </View>
    </View>
  );
}

function LadderRow({ progress, isFirst }: { progress: ForgeLadderProgress; isFirst: boolean }) {
  const name = FORGE_LADDER_NAMES[progress.ladder];
  const band = FORGE_BAND_NAMES[progress.band];
  const isMet = progress.total >= progress.target;
  const total = formatForgeAmount(progress.total, progress.unit);
  const target = formatForgeAmount(progress.target, progress.unit);
  const railPercent = Math.min(100, Math.max(0, progress.progress * 100));
  const spoken = `${name}, ${band} level ${progress.level}: ${total} of ${target} ${progress.unit}${isMet ? ', target met' : ''}`;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={spoken}
      className={`flex-row items-center gap-3 px-[14px] py-3 ${isFirst ? '' : 'border-t border-borderFaint'}`}>
      <ForgeMark ladder={progress.ladder} band={progress.band} size={34} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="font-archivo text-row-title font-semibold text-text">{name}</Text>
          <View className="flex-row items-center gap-1">
            {isMet ? <Icon name="check" size={12} color={colors.green} /> : null}
            <Text
              maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
              className={`font-archivo text-week-count font-semibold ${isMet ? 'text-green' : 'text-text'}`}
              style={{ fontVariant: ['tabular-nums'] }}>
              {`${total} `}
              <Text className={`font-medium ${isMet ? 'text-green' : 'text-dimmer'}`}>
                {`/ ${target} ${unitLabel(progress.unit)}`}
              </Text>
            </Text>
          </View>
        </View>
        <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">{`${band} · Level ${progress.level}`}</Text>
        <View className="mt-2 h-[3px] overflow-hidden rounded-[2px] bg-weekRailTrack">
          {railPercent > 0 ? (
            <View
              className="h-[3px] rounded-[2px]"
              style={{
                width: `${railPercent}%`,
                backgroundColor: isMet ? colors.green : BAND_FINISH[progress.band].light,
              }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * A ladder with no answer yet: the name, a dash, and an empty rail. The badge space and the
 * subtitle line are kept (blank), so the card is the same height before and after it loads.
 */
function PendingRow({ ladder, isFirst }: { ladder: ForgeLadder; isFirst: boolean }) {
  const name = FORGE_LADDER_NAMES[ladder];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${name}: not loaded yet`}
      className={`flex-row items-center gap-3 px-[14px] py-3 ${isFirst ? '' : 'border-t border-borderFaint'}`}>
      <View className="h-[34px] w-[34px]" />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="font-archivo text-row-title font-semibold text-text">{name}</Text>
          <Text className="font-archivo text-week-count font-medium text-dimmer">—</Text>
        </View>
        <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer"> </Text>
        <View className="mt-2 h-[3px] rounded-[2px] bg-weekRailTrack" />
      </View>
    </View>
  );
}
