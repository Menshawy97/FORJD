import type { PublicForge } from '@forjd/contracts';
import { FORGE_LADDER_IS_PUBLIC } from '@forjd/domain';
import { Text, View } from 'react-native';

import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';
import { ForgeProfileRows } from './forge-profile-rows';

/**
 * The Weekly Forge block on someone else's public athlete profile (Phase 7 mock-up, item I): the
 * athlete screen's section label (26 px above), then the profile rows for the four public ladders.
 *
 * The server sends this block only when the athlete's profile is public and the feature is on, and
 * the contract cannot carry Nourish (ADR-057 decision 8). It is filtered again here anyway, so a
 * future contract slip still could not put someone's meals on a stranger's screen.
 */
export function PublicForgeSection({ forge }: { forge: PublicForge | null }) {
  const ladders = forge?.ladders.filter((ladder) => FORGE_LADDER_IS_PUBLIC[ladder.ladder]) ?? [];
  if (ladders.length === 0) {
    return null;
  }
  return (
    <View>
      <Text
        maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
        className="mb-[9px] mt-[26px] font-archivo text-section-label font-semibold uppercase text-label">
        Weekly Forge
      </Text>
      <ForgeProfileRows ladders={ladders} />
    </View>
  );
}
