import type { LeaderboardRow } from '@forjd/contracts';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';
import { deltaView, formatScore, rowName, type DeltaTone } from './rank-format';

/**
 * One leaderboard row, transcribed from `rankVals()`'s `rowStyle` / `numStyle` / `avStyle` /
 * `nameStyle` / `scoreStyle` / `deltaStyle`:
 *
 * - row: `gap:12`, `padding:'13px 12px'`, `margin:'0 -12px'`, a 1px `.05` rule underneath and a
 *   2px left border. The caller's own row takes the accent left border, `rgba(233,113,47,.09)`
 *   fill and `borderRadius:'0 8px 8px 0'`; every other row a transparent left border.
 * - rank number: 24 wide, `600 13px/1`, tabular; avatar: 30x30 circle holding a 17px person glyph.
 * - name: `500 14px/1` (`700` and accent for the caller); score: `700 14.5px/1`, tabular; delta
 *   under it: `marginTop:4`, `500 10.5px/1`.
 *
 * The prototype paints the rank number and the other rows' avatar glyph in a faint grey. That grey
 * was retired for readability in 8H, so they take `dimmer` (`#8A8A82`) instead.
 *
 * A row is tappable only when `onPress` is given: a private profile (decision D10) shows its name
 * and username but cannot be opened, so it renders as a plain row with no button semantics.
 * Avatars are the design's person glyph, not the athlete's photo, exactly as the screenshot draws
 * them.
 */
interface RankRowProps {
  row: LeaderboardRow;
  onPress?: () => void;
}

const DELTA_COLOR: Record<DeltaTone, string> = {
  up: colors.green,
  down: colors.destructive,
  flat: colors.legal,
};

export function RankRow({ row, onPress }: RankRowProps) {
  const delta = deltaView(row.delta);
  const self = row.isSelf;
  const numberColor = self ? colors.accent : colors.dimmer;

  const content = (
    <>
      <Text
        style={{
          width: 24,
          fontFamily: 'Archivo',
          fontSize: 13,
          lineHeight: 13,
          fontWeight: '600',
          color: numberColor,
          fontVariant: ['tabular-nums'],
        }}>
        {row.rank}
      </Text>
      <View
        className={`h-[30px] w-[30px] flex-none items-center justify-center rounded-full ${
          self ? 'bg-rankSelfAvatarBg' : 'bg-elevated2'
        }`}>
        <Icon name="profile" size={17} color={numberColor} />
      </View>
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'Archivo',
          fontSize: 14,
          lineHeight: 14,
          fontWeight: self ? '700' : '500',
          color: self ? colors.accent : colors.text,
        }}>
        {rowName(row)}
      </Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 14.5,
            lineHeight: 14.5,
            fontWeight: '700',
            color: self ? colors.accent : colors.text,
            fontVariant: ['tabular-nums'],
          }}>
          {formatScore(row.score)}
        </Text>
        {/* Always occupies its line, so a row with no baseline is the same height as the rest. */}
        <View style={{ marginTop: 4, height: 10.5 }}>
          {delta ? (
            <Text
              style={{
                fontFamily: 'Archivo',
                fontSize: 10.5,
                lineHeight: 10.5,
                fontWeight: '500',
                color: DELTA_COLOR[delta.tone],
              }}>
              {delta.text}
            </Text>
          ) : null}
        </View>
      </View>
    </>
  );

  const className = `-mx-[12px] flex-row items-center gap-[12px] border-b border-l-2 border-b-borderFaint px-[12px] py-[13px] ${
    self ? 'rounded-r-[8px] border-l-accent bg-rankSelfRowBg' : 'border-l-transparent'
  }`;

  if (!onPress) {
    return <View className={className}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Rank ${row.rank}, ${rowName(row)}, score ${formatScore(row.score)}`}
      onPress={onPress}
      className={className}>
      {content}
    </Pressable>
  );
}
