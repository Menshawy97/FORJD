import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';
import { ForgeProfileRows } from './forge-profile-rows';
import { ForgeShareAllCard } from './forge-share-all-card';
import type { ForgeShare } from './use-forge-share';
import { useForgeWeek } from './use-forge-week';

/**
 * The Weekly Forge section on your own profile (Phase 7 mock-up, item I): the section label
 * (22 px above), all five ladders with the bands earned so far and the Forged record, and a note
 * that Nourish is only ever shown to you.
 *
 * - Each row opens that ladder's levels (weekly-forge-explainer-plan.md D5).
 * - A Share link on the right of the label, in the `week-count` style, shares every public ladder on
 *   one card (X4, mock-up F1). The profile tab owns the share flow (`share`), so its toast and
 *   capture layer sit at screen level rather than inside the scrolling list.
 *
 * Fed by `useForgeWeek`, like Home's card, so the flag, stale answers and failed refreshes follow
 * the same rules. It draws nothing until the first answer arrives: the mock-up has no loading
 * state for the profile, and an empty card would only push the settings down and back up.
 */
export function ProfileForgeSection({ share }: { share?: ForgeShare }) {
  const { isVisible, forge } = useForgeWeek();
  if (!isVisible || !forge) {
    return null;
  }
  return (
    <View>
      <View className="mb-[9px] mt-[22px] flex-row items-center justify-between">
        <Text
          maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
          className="font-archivo text-section-label font-semibold uppercase text-label">
          Weekly Forge
        </Text>
        {share ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share your Weekly Forge"
            hitSlop={14}
            onPress={() => share.start((username) => <ForgeShareAllCard ladders={forge.ladders} username={username} />)}>
            <Text
              maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
              className="font-archivo text-week-count font-semibold text-accent">
              Share
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ForgeProfileRows ladders={forge.ladders} onPressLadder={(ladder) => router.push(`/forge/${ladder}`)} />
      <Text className="mt-[10px] font-archivo text-legal">Nourish is only ever shown to you.</Text>
    </View>
  );
}
