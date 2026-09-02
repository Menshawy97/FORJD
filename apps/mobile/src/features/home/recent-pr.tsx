import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/**
 * Home's "Recent PR" section. A personal record is derived from logged sets, which the
 * workout engine (Phase 3) has yet to produce -- so the card keeps its shape and says there
 * is no PR, rather than showing the design's 100 kg bench press, which is demo data and would
 * read as a claim about this user's own lifting.
 *
 * The star tile keeps its accent ground but its glyph is drawn in `label` rather than the
 * accent, which is the visual difference between "here is your PR" and "here is where your
 * PR will be".
 */
export function RecentPr() {
  return (
    <View>
      <Text className="mb-[9px] mt-[22px] font-archivo text-section-label font-semibold uppercase text-label">
        Recent PR
      </Text>
      <View className="flex-row items-center gap-[13px] rounded-card border border-border bg-surface px-[15px] py-[14px]">
        <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-accentTileBg">
          <Icon name="star" size={19} color={colors.label} />
        </View>
        <View className="flex-1">
          <Text className="font-archivo text-pr-title font-semibold text-text">No PR yet</Text>
          <Text className="mt-[5px] font-archivo text-pr-meta text-dimmer">
            Finish a workout to set one
          </Text>
        </View>
      </View>
    </View>
  );
}
