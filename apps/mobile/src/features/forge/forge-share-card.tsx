import {
  FORGE_BAND_NAMES,
  FORGE_LADDER_IS_PUBLIC,
  FORGE_LADDER_NAMES,
  FORGE_LADDER_UNITS,
  targetOf,
  type ForgeBand,
  type ForgeLadder,
} from '@forjd/domain';
import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { LogoMark } from '@/components/brand/logo-mark';
import { Wordmark } from '@/components/brand/wordmark';
import { colors } from '@/theme/tokens';
import { ForgeMark } from './forge-mark';
import { formatForgeAmount, unitLabel } from './forge-format';

/**
 * The Weekly Forge share card, as approved in the Phase 7 mock-ups (item J): a 4:5 card (300 x 375,
 * captured at 1080 x 1350), 18 px corners, a `border` outline, 26/22/20 px padding, centred:
 *
 * - the "Weekly Forge" section label, then the 110 px badge 22 px below;
 * - the band name (30 px, 800, -.03em) 14 px below, then "Volume · 5,600 kg a week" and the level
 *   (13 px, 500, `textSecondary`, 1.4 line height) 8 px below;
 * - a footer pinned to the bottom above a `border` rule: `@username` on the left (11 px, `dimmer`),
 *   the FORJD symbol (16 px) and wordmark (11 px tall) on the right, 7 px apart.
 *
 * The background is the ember glow, `rgba(233,113,47,.26)` fading to `screenBg` at 62%, or for
 * Forged the white-hot `rgba(255,241,214,.18)` (the Heat knock-on in "Phase 7 outcome").
 *
 * Only what the public profile already shows appears here, and Nourish is never drawn: the card
 * renders nothing for it, whatever asks.
 */
export const SHARE_CARD_WIDTH = 300;
export const SHARE_CARD_HEIGHT = 375;

interface ForgeShareCardProps {
  ladder: ForgeLadder;
  band: ForgeBand;
  level: number;
  username: string | null;
}

export function ForgeShareCard({ ladder, band, level, username }: ForgeShareCardProps) {
  const glowId = `forge-share-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!FORGE_LADDER_IS_PUBLIC[ladder]) {
    return null;
  }
  const unit = FORGE_LADDER_UNITS[ladder];
  const target = safeTarget(ladder, level);
  const isForged = band === 'forged';

  return (
    <View
      className="items-center overflow-hidden rounded-[18px] border border-border bg-screenBg px-[22px] pb-5 pt-[26px]"
      style={{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT }}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id={glowId} cx="0.5" cy="0" rx="1.2" ry="0.8" gradientUnits="objectBoundingBox">
            <Stop
              offset="0"
              stopColor={isForged ? colors.forgeHeatWhite : colors.accent}
              stopOpacity={isForged ? 0.18 : 0.26}
            />
            <Stop offset="0.62" stopColor={colors.screenBg} stopOpacity="1" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${glowId})`} />
      </Svg>

      <Text className="font-archivo text-section-label font-semibold uppercase text-label">Weekly Forge</Text>
      <View className="mt-[22px]">
        <ForgeMark ladder={ladder} band={band} size={110} />
      </View>
      <Text className="mt-[14px] font-archivo text-[30px] font-extrabold tracking-[-0.9px] text-text">
        {FORGE_BAND_NAMES[band]}
      </Text>
      <Text className="mt-2 text-center font-archivo text-[13px] font-medium leading-[18px] text-textSecondary">
        {target === null
          ? FORGE_LADDER_NAMES[ladder]
          : `${FORGE_LADDER_NAMES[ladder]} · ${formatForgeAmount(target, unit)} ${unitLabel(unit)} a week`}
      </Text>
      <Text className="text-center font-archivo text-[13px] font-medium leading-[18px] text-textSecondary">
        {`Level ${level}`}
      </Text>

      <View className="mt-auto w-full flex-row items-center justify-between border-t border-border pt-3">
        <Text className="font-archivo text-[11px] font-medium text-dimmer">{username ? `@${username}` : ''}</Text>
        <View className="flex-row items-center gap-[7px]">
          <LogoMark size={16} />
          <Wordmark height={11} />
        </View>
      </View>
    </View>
  );
}

/** A level outside the tier table leaves the target out rather than crashing the share flow. */
function safeTarget(ladder: ForgeLadder, level: number): number | null {
  try {
    return targetOf(ladder, level);
  } catch {
    return null;
  }
}
