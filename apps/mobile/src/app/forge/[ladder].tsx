import type { ForgeLadderProgress } from '@forjd/contracts';
import {
  FORGE_BAND_NAMES,
  FORGE_BANDS,
  FORGE_LADDER_NAMES,
  FORGE_LADDER_UNITS,
  FORGE_LADDERS,
  FORGE_TIERS,
  type ForgeBand,
  type ForgeLadder,
} from '@forjd/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { BAND_FINISH } from '@/features/forge/band-finish';
import { formatForgeAmount, unitLabel, type ForgeUnit } from '@/features/forge/forge-format';
import { ForgeMark } from '@/features/forge/forge-mark';
import { outlookLine } from '@/features/forge/forge-outlook-copy';
import { useForgeWeek } from '@/features/forge/use-forge-week';
import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';
import { colors } from '@/theme/tokens';

/**
 * One Weekly Forge ladder and every level on it (weekly-forge-explainer-plan.md D5; mock-ups D and E,
 * approved 2026-09-27). Opened from a ladder row on Home, on your own profile, or in How it works.
 * Share and the badge's celebration replay arrive in X4.
 *
 * The level list comes from `FORGE_TIERS`, which is built into the app, so it shows offline. Only
 * the top card needs the week: a dash while it loads, and "Level not loaded" if it could not be read.
 */
function isForgeLadder(value: unknown): value is ForgeLadder {
  return typeof value === 'string' && (FORGE_LADDERS as readonly string[]).includes(value);
}

export default function ForgeLadderScreen() {
  const { ladder: param } = useLocalSearchParams<{ ladder?: string }>();
  const ladder = isForgeLadder(param) ? param : null;
  const { forge, loadFailed, reload } = useForgeWeek();
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!ladder) {
      router.replace('/(tabs)');
    }
  }, [ladder]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await reload();
    } finally {
      setIsRefreshing(false);
    }
  }, [reload]);

  if (!ladder) {
    return null;
  }
  const progress = forge?.ladders.find((candidate) => candidate.ladder === ladder) ?? null;

  return (
    <ScreenBackground>
      <Header title={FORGE_LADDER_NAMES[ladder]} onBack={() => router.back()} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.dim} />}>
        <TopCard ladder={ladder} progress={progress} loadFailed={loadFailed} />
        {progress ? (
          <Text className="mt-3 font-archivo text-[13px] leading-[1.5] text-dim">{outlookLine(progress)}</Text>
        ) : null}
        <LevelList ladder={ladder} level={progress?.level ?? null} />
      </ScrollView>

      <TabBar active="home" />
    </ScreenBackground>
  );
}

function TopCard({
  ladder,
  progress,
  loadFailed,
}: {
  ladder: ForgeLadder;
  progress: ForgeLadderProgress | null;
  loadFailed: boolean;
}) {
  if (!progress) {
    return (
      <View className="rounded-card border border-border bg-surface">
        <View className="flex-row items-center gap-[14px] px-4 py-[14px]">
          <ForgeMark ladder={ladder} band="ore" size={48} decorative />
          <View className="min-w-0 flex-1">
            {loadFailed ? (
              <>
                <Text className="font-archivo text-[19px] font-bold leading-[1.15] tracking-[-0.19px] text-text">
                  Level not loaded
                </Text>
                <Text className="mt-[6px] font-archivo text-row-subtitle text-dimmer">
                  Your level couldn't load. Check your connection, then pull down to try again.
                </Text>
              </>
            ) : (
              <Text className="font-archivo text-[19px] font-bold leading-[1.15] text-dimmer">—</Text>
            )}
          </View>
        </View>
      </View>
    );
  }

  const band = FORGE_BAND_NAMES[progress.band];
  const isMet = progress.total >= progress.target;
  const railPercent = Math.min(100, Math.max(0, progress.progress * 100));
  const total = formatForgeAmount(progress.total, progress.unit);
  const target = formatForgeAmount(progress.target, progress.unit);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${band}, level ${progress.level}. This week ${total} of ${target} ${unitLabel(progress.unit)}${isMet ? ', target met' : ''}`}
      className="rounded-card border border-border bg-surface">
      <View className="flex-row items-center gap-[14px] px-4 py-[14px]">
        <ForgeMark ladder={ladder} band={progress.band} size={48} decorative />
        <View className="min-w-0 flex-1">
          <Text className="font-archivo text-[19px] font-bold leading-[1.15] tracking-[-0.19px] text-text">
            {`${band} · Level ${progress.level}`}
          </Text>
          <View className="mt-2 flex-row items-baseline justify-between gap-2">
            <Text className="font-archivo text-row-subtitle text-dimmer">This week</Text>
            <View className="flex-row items-center gap-1">
              {isMet ? <Icon name="check" size={12} color={colors.green} /> : null}
              <Text
                maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
                className={`font-archivo text-week-count font-semibold ${isMet ? 'text-green' : 'text-text'}`}
                style={{ fontVariant: ['tabular-nums'] }}>
                {`${total} `}
                <Text className={`font-medium ${isMet ? 'text-green' : 'text-dimmer'}`}>
                  {`/ ${target} ${unitLabel(progress.unit)}`}
                </Text>
              </Text>
            </View>
          </View>
          <View className="mt-2 h-[3px] overflow-hidden rounded-[2px] bg-weekRailTrack">
            {railPercent > 0 ? (
              <View
                className="h-[3px] rounded-[2px]"
                style={{
                  width: `${railPercent}%`,
                  backgroundColor: isMet ? colors.green : BAND_FINISH[progress.band].light,
                }}
              />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

type Place = 'unknown' | 'past' | 'current' | 'next' | 'ahead';

function placeOf(tierLevel: number, level: number | null): Place {
  if (level === null) return 'unknown';
  if (tierLevel < level) return 'past';
  if (tierLevel === level) return 'current';
  return tierLevel === level + 1 ? 'next' : 'ahead';
}

function LevelList({ ladder, level }: { ladder: ForgeLadder; level: number | null }) {
  const unit = FORGE_LADDER_UNITS[ladder] as ForgeUnit;
  const bands = FORGE_BANDS.filter((band) => FORGE_TIERS[ladder].some((tier) => tier.band === band));

  return (
    <View>
      {bands.map((band) => {
        const tiers = FORGE_TIERS[ladder].filter((tier) => tier.band === band);
        const first = tiers[0]!.level;
        const last = tiers[tiers.length - 1]!.level;
        return (
          <View key={band}>
            <BandHead ladder={ladder} band={band} range={first === last ? `Level ${first}` : `Levels ${first}–${last}`} />
            <View className="overflow-hidden rounded-card border border-border bg-surface">
              {tiers.map((tier, index) => (
                <LevelRow
                  key={tier.level}
                  level={tier.level}
                  goal={`${formatForgeAmount(tier.target, unit)} ${goalUnit(unit, tier.target)} a week`}
                  place={placeOf(tier.level, level)}
                  isFirst={index === 0}
                />
              ))}
            </View>
            {band === 'forged' ? (
              <Text className="mt-2 font-archivo text-[11.5px] leading-[1.5] text-dimmer">
                Reached after 4 weeks in a row in Tempered.
              </Text>
            ) : null}
          </View>
        );
      })}
      {ladder === 'nourish' ? (
        <Text className="mt-2 font-archivo text-[11.5px] leading-[1.5] text-dimmer">
          Nourish ends at Anvil: 6 days a week is the top, with no Tempered or Forged.
        </Text>
      ) : null}
    </View>
  );
}

function BandHead({ ladder, band, range }: { ladder: ForgeLadder; band: ForgeBand; range: string }) {
  return (
    <View className="mb-2 mt-5 flex-row items-center gap-2">
      <ForgeMark ladder={ladder} band={band} size={20} decorative />
      <Text className="font-archivo text-section-label font-semibold uppercase text-textSecondary">
        {FORGE_BAND_NAMES[band]}
      </Text>
      <Text className="font-archivo text-section-label font-semibold uppercase text-label">{range}</Text>
    </View>
  );
}

function LevelRow({ level, goal, place, isFirst }: { level: number; goal: string; place: Place; isFirst: boolean }) {
  const isCurrent = place === 'current';
  const spokenPlace = isCurrent ? ', your level' : place === 'next' ? ', next' : place === 'past' ? ', passed' : '';

  return (
    <View
      accessible
      accessibilityLabel={`Level ${level}, ${goal}${spokenPlace}`}
      // Your level: the mock-up's 8% accent fill, the same value as the existing `trainingTipBg`.
      className={`flex-row items-center gap-[10px] px-[14px] py-[10px] ${isFirst ? '' : 'border-t border-borderFaint'} ${isCurrent ? 'bg-trainingTipBg' : ''}`}>
      {isCurrent ? <View className="absolute bottom-0 left-0 top-0 w-[3px] bg-accent" /> : null}
      <Text
        className={`w-[58px] font-archivo text-[12px] font-medium leading-none ${isCurrent ? 'text-text' : 'text-dimmer'}`}
        style={{ fontVariant: ['tabular-nums'] }}>
        {`Level ${level}`}
      </Text>
      <Text
        className={`flex-1 font-archivo text-[13px] leading-none ${place === 'past' ? 'font-medium text-dimmer' : 'font-semibold text-text'}`}
        style={{ fontVariant: ['tabular-nums'] }}>
        {goal}
      </Text>
      {isCurrent ? (
        <View className="rounded-[5px] bg-accentDark px-[6px] py-1">
          <Text className="font-archivo text-[10px] font-bold uppercase leading-none tracking-[0.6px] text-onAccent">You</Text>
        </View>
      ) : null}
      {place === 'next' ? (
        <View className="rounded-[5px] bg-iconButtonPressedBg px-[6px] py-1">
          <Text className="font-archivo text-[10.5px] font-semibold leading-none text-textSecondary">Next</Text>
        </View>
      ) : null}
    </View>
  );
}

/** "workout" and "day" for exactly one; every other unit reads the same for any amount. */
function goalUnit(unit: ForgeUnit, value: number): string {
  if (value === 1 && unit === 'workouts') return 'workout';
  if (value === 1 && unit === 'days') return 'day';
  return unitLabel(unit);
}
