import { Text, View } from 'react-native';

import type { ProgressMuscleSplitRow } from '@forjd/contracts';

const BUCKET_LABELS: Record<string, string> = {
  legs: 'Legs',
  back: 'Back',
  chest: 'Chest',
  shoulders: 'Shoulders',
  arms: 'Arms',
  core: 'Core',
};

/**
 * "Muscle group split" (`progress strength.png`). Rows are already ordered by descending
 * share and sum to 100 -- `toPercentages` in `@forjd/domain` guarantees both -- so this
 * component only draws what it is given, never re-sorting or re-normalising.
 *
 * The bar's width is the raw percentage, not scaled against the largest row's share, matching
 * the prototype's `muscleVals()` (`width: pct + '%'`) exactly: Legs at 28% fills 28% of the
 * track, not 100% of it.
 */
interface MuscleSplitProps {
  rows: readonly ProgressMuscleSplitRow[];
}

export function MuscleSplit({ rows }: MuscleSplitProps) {
  if (rows.length === 0) {
    return (
      <Text style={{ fontFamily: 'Archivo', fontSize: 13, color: '#9A9A92' }}>
        Log a weighted set this month to see which muscle groups you are training.
      </Text>
    );
  }

  return (
    <View>
      {rows.map((row) => (
        <View
          key={row.bucket}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Text
            style={{
              width: 64,
              flexShrink: 0,
              fontFamily: 'Archivo',
              fontSize: 12,
              fontWeight: '600',
              color: '#C8C8C0',
            }}>
            {BUCKET_LABELS[row.bucket] ?? row.bucket}
          </Text>
          <View
            style={{
              flex: 1,
              height: 7,
              borderRadius: 4,
              backgroundColor: '#232427',
              overflow: 'hidden',
            }}>
            <View
              style={{
                width: `${row.percent}%`,
                height: 7,
                borderRadius: 4,
                backgroundColor: '#E9712F',
              }}
            />
          </View>
          <Text
            style={{
              width: 34,
              flexShrink: 0,
              textAlign: 'right',
              fontFamily: 'Archivo',
              fontSize: 12,
              fontWeight: '600',
              color: '#F6F5F3',
              fontVariant: ['tabular-nums'],
            }}>
            {`${row.percent}%`}
          </Text>
        </View>
      ))}
    </View>
  );
}
