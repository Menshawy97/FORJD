import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/**
 * Home's insight card. A real insight is a longitudinal-analytics output -- the fourth of
 * CLAUDE.md's architecturally-critical pillars, and the one furthest from being built: it
 * needs training load, which needs the workout engine, and HRV trend, which needs Health
 * Connect.
 *
 * The design's copy ("Training load up 14% this week. HRV has been stable...") is demo text.
 * Rendering it would be putting a fabricated claim about the user's own training in front of
 * them, so the card keeps its chrome and says what is actually true: there is nothing to
 * report yet, and here is how to change that.
 *
 * **Titled "FORJD Insight", not "AI insight"** (ADR-030). Every sentence this family of cards
 * can ever show -- here and on the Progress tab's Strength view -- is assembled from the
 * athlete's own numbers against published training-science thresholds, via `evaluateInsight`
 * in `@forjd/domain`. It is not a model's output, and labelling it as one would be a false
 * claim about how the app works.
 */
export function InsightCard() {
  return (
    <View className="flex-row gap-3 rounded-card border border-border bg-surface px-[15px] py-[14px]">
      <View className="h-[34px] w-[34px] items-center justify-center rounded-chip bg-accentTileBg">
        <Icon name="bolt" size={19} color={colors.accent} />
      </View>
      <View className="flex-1">
        <Text className="mb-[7px] font-archivo text-section-label font-semibold uppercase text-accent">
          FORJD Insight
        </Text>
        <Text className="font-archivo text-insight-body font-medium text-insightBody">
          Log a few workouts and we&apos;ll start spotting patterns.
        </Text>
      </View>
    </View>
  );
}
