import { FORGE_BAND_NAMES, FORGE_BANDS, FORGE_LADDER_NAMES, FORGE_LADDERS, type ForgeBand, type ForgeLadder } from '@forjd/domain';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { pressGhost } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import type { ChipTone } from '@/features/forge/forge-copy';
import { FORGE_LADDER_COUNTS } from '@/features/forge/forge-guide';
import { ForgeMark } from '@/features/forge/forge-mark';
import { useForgeWeek } from '@/features/forge/use-forge-week';
import { CHIP_CLASS } from '@/features/forge/week-summary-sheet';
import { markForgeHowItWorksSeen } from '@/store/forge-how-it-works-shown';
import { colors } from '@/theme/tokens';

/**
 * Weekly Forge → How it works (weekly-forge-explainer-plan.md D4, mock-up C, approved 2026-09-27).
 * Opened from the info icon on the Home card, and by itself once, the first time Home shows the card
 * with a week (docs/product/forge-how-it-works-once-plan.md).
 *
 * The rules are written into the app, so the screen reads fine offline. Only the badge and level on
 * each ladder row come from the week, and until it loads they show the Ore badge and a dash.
 */
const RULES: ReadonlyArray<{ tone: ChipTone; tag: string; lead: string; rest: string }> = [
  { tone: 'up', tag: 'Up 1', lead: 'Hit your goal:', rest: " you go up one level, and next week's goal grows with it." },
  {
    tone: 'up',
    tag: 'Up to +3',
    lead: 'Beat it by a lot:',
    rest: ' you land on the highest level whose goal you beat, up to 3 levels at once.',
  },
  {
    tone: 'hold',
    tag: 'Held',
    lead: 'Miss it:',
    rest: ' you keep your level. After 3 misses in a row you ease down one level. Level 1 is the lowest.',
  },
  {
    tone: 'band',
    tag: 'Forged',
    lead: 'Reaching Forged:',
    rest: ' stay in Tempered for 4 weeks in a row. A miss while Forged moves you back to the top of Tempered.',
  },
];

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-[9px] mt-[22px] font-archivo text-section-label font-semibold uppercase text-label">
      {children}
    </Text>
  );
}

export default function HowItWorksScreen() {
  const { forge } = useForgeWeek();

  // Opened from the info icon counts too: Home will not open it by itself afterwards.
  useEffect(() => {
    void markForgeHowItWorksSeen();
  }, []);
  const byLadder = new Map(forge?.ladders.map((progress) => [progress.ladder, progress]));

  return (
    <ScreenBackground>
      <Header title="How it works" onBack={() => router.back()} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <Text className="font-archivo text-[13px] leading-[1.5] text-dim">
          Each week you get five goals, one per ladder. Your level on a ladder sets its goal: the higher the level, the
          bigger the goal. Weeks run Saturday to Friday and close at midnight on Friday, your time.
        </Text>

        <SectionLabel>The bands</SectionLabel>
        <View className="rounded-card border border-border bg-surface">
          <View className="flex-row justify-between px-[10px] pb-3 pt-[14px]">
            {FORGE_BANDS.map((band) => (
              <View key={band} className="w-14 items-center" style={{ gap: 7 }}>
                <ForgeMark ladder="volume" band={band} size={40} decorative />
                <Text className="font-archivo text-[11px] font-semibold text-textSecondary">{FORGE_BAND_NAMES[band]}</Text>
              </View>
            ))}
          </View>
          <Text className="px-[14px] pb-[13px] font-archivo text-[12.5px] leading-[1.45] text-dim">
            Levels are grouped into five bands, from Ore up to Forged, with 3 levels in each. The dots under a badge
            show which band it is, 1 to 5.
          </Text>
        </View>

        <SectionLabel>When the week closes</SectionLabel>
        <View className="rounded-card border border-border bg-surface">
          {RULES.map((rule, index) => (
            <View
              key={rule.tag}
              className={`flex-row items-start gap-3 px-[14px] py-[13px] ${index === 0 ? '' : 'border-t border-borderFaint'}`}>
              <View className={`min-w-[68px] items-center rounded-[7px] px-[7px] py-[6px] ${CHIP_CLASS[rule.tone].box}`}>
                <Text className={`font-archivo text-[11px] font-semibold ${CHIP_CLASS[rule.tone].text}`}>{rule.tag}</Text>
              </View>
              <Text className="flex-1 font-archivo text-[12.5px] leading-[1.45] text-dim">
                <Text className="font-semibold text-text">{rule.lead}</Text>
                {rule.rest}
              </Text>
            </View>
          ))}
        </View>

        <SectionLabel>What each ladder counts</SectionLabel>
        <View className="rounded-card border border-border bg-surface">
          {FORGE_LADDERS.map((ladder, index) => (
            <LadderRow key={ladder} ladder={ladder} progress={byLadder.get(ladder) ?? null} isFirst={index === 0} />
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More questions in the FAQ"
          onPress={() => router.push('/faq')}
          style={pressGhost}
          className="mt-3 flex-row items-center justify-between rounded-card border border-border bg-surface px-4 py-[14px]">
          <Text className="font-archivo text-[13.5px] font-semibold leading-[1.35] text-text">More questions in the FAQ</Text>
          <Icon name="chevron" size={16} color={colors.metadata} />
        </Pressable>
      </ScrollView>

      <TabBar active="home" />
    </ScreenBackground>
  );
}

function LadderRow({
  ladder,
  progress,
  isFirst,
}: {
  ladder: ForgeLadder;
  progress: { band: ForgeBand; level: number } | null;
  isFirst: boolean;
}) {
  const name = FORGE_LADDER_NAMES[ladder];
  const counts = FORGE_LADDER_COUNTS[ladder];
  const detail = ladder === 'nourish' ? `${counts} · Only you see this` : counts;
  const spokenCounts = counts.charAt(0).toLowerCase() + counts.slice(1);
  const spokenLevel = progress ? `, level ${progress.level}` : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}${spokenLevel}. Counts ${spokenCounts}. Opens all levels`}
      onPress={() => router.push(`/forge/${ladder}`)}
      style={pressGhost}
      className={`flex-row items-center gap-3 px-[14px] py-3 ${isFirst ? '' : 'border-t border-borderFaint'}`}>
      <ForgeMark ladder={ladder} band={progress?.band ?? 'ore'} size={30} decorative />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="font-archivo text-row-title font-semibold text-text">{name}</Text>
          <Text className="font-archivo text-row-subtitle text-dimmer">{progress ? `Level ${progress.level}` : '—'}</Text>
        </View>
        <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">{detail}</Text>
      </View>
      <Icon name="chevron" size={16} color={colors.metadata} />
    </Pressable>
  );
}
