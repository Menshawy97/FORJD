import { Text, View } from 'react-native';

import type { ProgressPersonalRecord } from '@forjd/contracts';

/**
 * One of Progress' two PR tiles (`progress strength.png`). Headed with the exercise's own
 * name -- the design's literal "Bench PR" / "Squat PR" labels are demo copy for two specific
 * lifts; the athlete's two *most recently achieved* records fill these slots instead, so a
 * runner or a machine-only lifter sees their own two lifts rather than two empty tiles.
 */
interface PrTileProps {
  record: ProgressPersonalRecord;
}

export function PrTile({ record }: PrTileProps) {
  const delta = record.deltaKgSinceLastMonth;

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
        {`${record.exerciseName} PR`}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 25,
            fontWeight: '700',
            letterSpacing: -0.02 * 25,
            color: '#F6F5F3',
            fontVariant: ['tabular-nums'],
          }}>
          {Math.round(record.weightKg)}
        </Text>
        <Text style={{ fontFamily: 'Archivo', fontSize: 11.5, fontWeight: '500', color: '#6E6E66' }}>
          kg
        </Text>
      </View>
      {delta !== null ? (
        <Text
          style={{
            marginTop: 7,
            fontFamily: 'Archivo',
            fontSize: 11,
            fontWeight: '500',
            color: delta >= 0 ? '#79B98A' : '#C9503C',
          }}>
          {`${delta >= 0 ? '+' : ''}${delta} kg this month`}
        </Text>
      ) : null}
    </View>
  );
}
