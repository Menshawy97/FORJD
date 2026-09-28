import { FORGE_BAND_NAMES, FORGE_LADDER_IS_PUBLIC, FORGE_LADDER_NAMES } from '@forjd/domain';
import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { LogoMark } from '@/components/brand/logo-mark';
import { Wordmark } from '@/components/brand/wordmark';
import { colors } from '@/theme/tokens';
import type { ForgeProfileLadder } from './forge-profile-rows';
import { ForgeMark } from './forge-mark';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from './forge-share-card';

/**
 * Every public ladder on one 4:5 card, for the Share link on your profile's Weekly Forge section
 * (weekly-forge-explainer-plan.md X4; mock-up F2, approved 2026-09-27). It keeps the approved
 * single-ladder card's frame, padding, glow and footer (`forge-share-card.tsx`) and swaps its big
 * badge for one row per ladder: a 40 px badge, the ladder name and "Band · Level n", 9 px of
 * padding, split by `borderFaint`.
 *
 * The glow is white-hot when any ladder shown is Forged, ember otherwise. Nourish is never drawn,
 * whatever it is given, the same guard as the single-ladder card; with nothing public it renders
 * nothing.
 */
interface ForgeShareAllCardProps {
  ladders: readonly Pick<ForgeProfileLadder, 'ladder' | 'band' | 'level'>[];
  username: string | null;
}

export function ForgeShareAllCard({ ladders, username }: ForgeShareAllCardProps) {
  const glowId = `forge-share-all-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const shown = ladders.filter((ladder) => FORGE_LADDER_IS_PUBLIC[ladder.ladder]);
  if (shown.length === 0) {
    return null;
  }
  const isForged = shown.some((ladder) => ladder.band === 'forged');

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
      <View className="mt-[18px] w-full">
        {shown.map((ladder, index) => (
          <View
            key={ladder.ladder}
            className={`flex-row items-center gap-3 py-[9px] ${index === 0 ? '' : 'border-t border-borderFaint'}`}>
            <ForgeMark ladder={ladder.ladder} band={ladder.band} size={40} decorative />
            <View className="min-w-0 flex-1">
              <Text className="font-archivo text-[14px] font-semibold leading-[1.25] text-text">
                {FORGE_LADDER_NAMES[ladder.ladder]}
              </Text>
              <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">
                {`${FORGE_BAND_NAMES[ladder.band]} · Level ${ladder.level}`}
              </Text>
            </View>
          </View>
        ))}
      </View>

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
