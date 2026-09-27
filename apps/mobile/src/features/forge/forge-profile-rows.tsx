import {
  FORGE_BAND_NAMES,
  FORGE_BANDS,
  FORGE_LADDER_NAMES,
  maxBandOf,
  type ForgeBand,
  type ForgeLadder,
} from '@forjd/domain';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { pressGhost } from '@/components/press-feedback';
import { ForgeMark } from './forge-mark';

/**
 * The Weekly Forge rows on a profile, as approved in the Phase 7 mock-ups (item I, with the
 * Hallmark badge): the app's card with one row per ladder (padding 12/14, gap 12), a 38 px badge,
 * the ladder name (`row-title`) with "Band · Level n" (`row-subtitle`) on the right, then a strip of
 * 18 px badges for the bands earned so far (8 px below, 6 apart) and a dashed empty slot for each
 * band still to come, and, when there is one, the Forged record in Forged's white-hot colour.
 *
 * Shared by your own profile (five ladders) and the public athlete profile (four). The fields are
 * the ones both `ForgeLadderProgress` and the public block carry.
 */
export interface ForgeProfileLadder {
  ladder: ForgeLadder;
  band: ForgeBand;
  level: number;
  forgedStreak: number;
  bestForgedStreak: number;
  badges: readonly ForgeBand[];
}

interface ForgeProfileRowsProps {
  ladders: readonly ForgeProfileLadder[];
  /**
   * Your own profile passes this, and each row opens that ladder's levels
   * (weekly-forge-explainer-plan.md D5). A public profile passes nothing, so its rows stay plain
   * (D7: other people see the bands, never the ladder screen).
   */
  onPressLadder?: (ladder: ForgeLadder) => void;
}

export function ForgeProfileRows({ ladders, onPressLadder }: ForgeProfileRowsProps) {
  return (
    <View className="rounded-card border border-border bg-surface">
      {ladders.map((ladder, index) => (
        <ProfileRow key={ladder.ladder} ladder={ladder} isFirst={index === 0} onPress={onPressLadder} />
      ))}
    </View>
  );
}

function ProfileRow({
  ladder,
  isFirst,
  onPress,
}: {
  ladder: ForgeProfileLadder;
  isFirst: boolean;
  onPress?: (ladder: ForgeLadder) => void;
}) {
  const name = FORGE_LADDER_NAMES[ladder.ladder];
  const band = FORGE_BAND_NAMES[ladder.band];
  // Nourish ends at Anvil, so its strip has three slots, not five.
  const bands = FORGE_BANDS.slice(0, FORGE_BANDS.indexOf(maxBandOf(ladder.ladder)) + 1);
  const earned = new Set(ladder.badges);
  const record = forgedRecord(ladder);
  const earnedNames = bands.filter((b) => earned.has(b)).map((b) => FORGE_BAND_NAMES[b]);
  const spoken =
    `${name}, ${band} level ${ladder.level}.` +
    (earnedNames.length > 0 ? ` Bands earned: ${earnedNames.join(', ')}.` : '') +
    (record ? ` ${record.spoken}.` : '');
  const rowClass = `flex-row items-center gap-3 px-[14px] py-3 ${isFirst ? '' : 'border-t border-borderFaint'}`;

  const content: ReactNode = (
    <>
      <ForgeMark ladder={ladder.ladder} band={ladder.band} size={38} decorative />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="font-archivo text-row-title font-semibold text-text">{name}</Text>
          <Text className="font-archivo text-row-subtitle text-dimmer">{`${band} · Level ${ladder.level}`}</Text>
        </View>
        <View className="mt-2 flex-row gap-[6px]">
          {bands.map((b) =>
            earned.has(b) ? (
              <ForgeMark key={b} ladder={ladder.ladder} band={b} size={18} decorative />
            ) : (
              <View
                key={b}
                testID="forge-band-slot-empty"
                className="h-[18px] w-[18px] rounded-[5px] border border-dashed border-forgeBandSlotBorder"
              />
            ),
          )}
        </View>
        {record ? (
          <Text className="mt-[6px] font-archivo text-row-subtitle text-forgeHeatWhite">{record.shown}</Text>
        ) : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${spoken} Opens all levels`}
        onPress={() => onPress(ladder.ladder)}
        style={pressGhost}
        className={rowClass}>
        {content}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={spoken} className={rowClass}>
      {content}
    </View>
  );
}

/** "Forged 1 week · best 3" while Forged; "Best Forged run: 2 weeks" after; nothing before. */
function forgedRecord({ forgedStreak, bestForgedStreak }: ForgeProfileLadder): { shown: string; spoken: string } | null {
  if (forgedStreak > 0) {
    const weeks = `${forgedStreak} ${forgedStreak === 1 ? 'week' : 'weeks'}`;
    return { shown: `Forged ${weeks} · best ${bestForgedStreak}`, spoken: `Forged ${weeks}, best ${bestForgedStreak}` };
  }
  if (bestForgedStreak > 0) {
    const text = `Best Forged run: ${bestForgedStreak} ${bestForgedStreak === 1 ? 'week' : 'weeks'}`;
    return { shown: text, spoken: text };
  }
  return null;
}
