import { Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { formatPace, splitBarPercent } from './run-format';

/**
 * The kilometre splits, shared by the live run and the run-complete screen (identical in
 * `s_run()` and `s_runDone()`): a "Splits" label with `22px 0 2px` margin, then one row per split,
 * padding `12px 0`, a `rgba(255,255,255,.05)` rule, gap 12. Each row is a 44px `600 12.5px` label in
 * `#b4b4ac`, a flexible 5px bar on `#26272a` (radius 3) filled with the accent, a 44px right-aligned
 * pace in `600 12.5px`, and a 52px right-aligned `500 11px` heart rate in `#7a7a72`.
 *
 * The bar is proportional to the fastest split (the design's are hard-coded 92 / 84 / 76%); a split
 * with no watch heart rate leaves its slot empty rather than printing a dash on every row.
 */
export interface RunSplitRow {
  index: number;
  durationSeconds: number;
  avgHeartRateBpm: number | null;
}

const MONO_NUMS = { fontVariant: ['tabular-nums' as const] };

export function RunSplits({ splits }: { splits: readonly RunSplitRow[] }) {
  const fastest = splits.reduce((least, s) => Math.min(least, s.durationSeconds), Infinity);

  return (
    <View>
      <Text
        className="mb-[2px] mt-[22px] font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
        style={{ color: colors.label }}>
        Splits
      </Text>
      {splits.map((split) => (
        <View
          key={split.index}
          className="flex-row items-center py-[12px]"
          style={{ gap: 12, borderBottomWidth: 1, borderBottomColor: colors.borderFaint }}>
          <Text className="w-[44px] font-archivo text-[12.5px] font-semibold" style={[{ color: '#B4B4AC' }, MONO_NUMS]}>
            {`${split.index} km`}
          </Text>
          <View className="h-[5px] flex-1 overflow-hidden rounded-[3px]" style={{ backgroundColor: colors.barTrack }}>
            <View
              className="h-[5px]"
              style={{
                width: `${splitBarPercent(split.durationSeconds, fastest)}%`,
                backgroundColor: colors.accent,
              }}
            />
          </View>
          <Text className="w-[44px] text-right font-archivo text-[12.5px] font-semibold text-text" style={MONO_NUMS}>
            {formatPace(split.durationSeconds)}
          </Text>
          <Text className="w-[52px] text-right font-archivo text-[11px] font-medium" style={[{ color: '#7A7A72' }, MONO_NUMS]}>
            {split.avgHeartRateBpm === null ? '' : `${split.avgHeartRateBpm} bpm`}
          </Text>
        </View>
      ))}
    </View>
  );
}
