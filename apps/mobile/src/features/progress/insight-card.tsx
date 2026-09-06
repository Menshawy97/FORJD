import { Text, View } from 'react-native';

import type { ProgressInsight } from '@forjd/contracts';

/**
 * Progress' "FORJD Insight" card (`progress strength 3.png`) -- **not** "AI insight" (ADR-030).
 * `insight` is the direct output of `evaluateInsight` in `@forjd/domain`, a sentence assembled
 * from the athlete's own numbers against published training-science thresholds. It is not a
 * model's output, and the heading must not claim otherwise.
 *
 * `null` is the honest state for an account with too little history to say anything true yet
 * -- rendered as an explanation, not as a missing card, so the design's chrome always shows
 * once there is at least some training data on the screen above it.
 */
interface InsightCardProps {
  insight: ProgressInsight | null;
}

export function InsightCard({ insight }: InsightCardProps) {
  return (
    <View
      style={{
        backgroundColor: '#17181A',
        borderWidth: 1,
        borderColor: 'rgba(233,113,47,.2)',
        borderRadius: 14,
        padding: 15,
        paddingHorizontal: 16,
        marginTop: 12,
      }}>
      <Text
        style={{
          fontFamily: 'Archivo',
          fontSize: 9.5,
          fontWeight: '600',
          letterSpacing: 0.14 * 9.5,
          textTransform: 'uppercase',
          color: '#E9712F',
          marginBottom: 9,
        }}>
        FORJD Insight
      </Text>
      {insight ? (
        <Text style={{ fontFamily: 'Archivo', fontSize: 13, lineHeight: 13 * 1.5, color: '#E4E2DE' }}>
          <Text style={{ fontWeight: '700' }}>{insight.headline} </Text>
          {insight.body}
        </Text>
      ) : (
        <Text style={{ fontFamily: 'Archivo', fontSize: 13, lineHeight: 13 * 1.5, color: '#E4E2DE' }}>
          Keep logging sessions and this card will start reporting real patterns in your
          training.
        </Text>
      )}
    </View>
  );
}
