import { Text, View } from 'react-native';

import type { ProgressPersonalRecord } from '@forjd/contracts';

/**
 * One of Progress' two PR tiles (`progress strength.png`). Headed with the exercise's own
 * name -- the design's literal "Bench PR" / "Squat PR" labels are demo copy for two specific
 * lifts; the athlete's two *most recently achieved* records fill these slots instead, so a
 * runner or a machine-only lifter sees their own two lifts rather than two empty tiles.
 *
 * **`record: null` is a real, expected state, not an edge case to hide.** Following
 * `recent-pr.tsx`'s own precedent on Home, an account with fewer than two personal records
 * still shows the tile's full chrome -- the row of two tiles never simply disappears, which
 * would read as a missing feature rather than an honest "you have not set this yet".
 */
interface PrTileProps {
  record: ProgressPersonalRecord | null;
}

export function PrTile({ record }: PrTileProps) {
  const delta = record?.deltaKgSinceLastMonth ?? null;

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        backgroundColor: '#17181A',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,.07)',
        borderRadius: 14,
        padding: 13,
        paddingHorizontal: 14,
      }}>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: 'Archivo',
          fontSize: 9.5,
          fontWeight: '600',
          letterSpacing: 0.14 * 9.5,
          textTransform: 'uppercase',
          color: '#77776F',
          marginBottom: 9,
        }}>
        {record === null ? 'PR' : `${record.exerciseName} PR`}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 25,
            fontWeight: '700',
            letterSpacing: -0.02 * 25,
            color: record === null ? '#6E6E66' : '#F6F5F3',
            fontVariant: ['tabular-nums'],
          }}>
          {record === null ? '—' : Math.round(record.weightKg)}
        </Text>
        {record !== null ? (
          <Text style={{ fontFamily: 'Archivo', fontSize: 11.5, fontWeight: '500', color: '#6E6E66' }}>
            kg
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          marginTop: 7,
          fontFamily: 'Archivo',
          fontSize: 11,
          fontWeight: '500',
          color: record === null ? '#6E6E66' : delta !== null && delta >= 0 ? '#79B98A' : '#C9503C',
        }}>
        {record === null
          ? 'Log a workout to set one'
          : delta !== null
            ? `${delta >= 0 ? '+' : ''}${delta} kg this month`
            : ' '}
      </Text>
    </View>
  );
}
