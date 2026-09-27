import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';
import { ForgeProfileRows } from './forge-profile-rows';
import { useForgeWeek } from './use-forge-week';

/**
 * The Weekly Forge section on your own profile (Phase 7 mock-up, item I): the section label
 * (22 px above), all five ladders with the bands earned so far and the Forged record, and a note
 * that Nourish is only ever shown to you.
 *
 * Fed by `useForgeWeek`, like Home's card, so the flag, stale answers and failed refreshes follow
 * the same rules. It draws nothing until the first answer arrives: the mock-up has no loading
 * state for the profile, and an empty card would only push the settings down and back up.
 */
export function ProfileForgeSection() {
  const { isVisible, forge } = useForgeWeek();
  if (!isVisible || !forge) {
    return null;
  }
  return (
    <View>
      <Text
        maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
        className="mb-[9px] mt-[22px] font-archivo text-section-label font-semibold uppercase text-label">
        Weekly Forge
      </Text>
      <ForgeProfileRows ladders={forge.ladders} onPressLadder={(ladder) => router.push(`/forge/${ladder}`)} />
      <Text className="mt-[10px] font-archivo text-legal">Nourish is only ever shown to you.</Text>
    </View>
  );
}
