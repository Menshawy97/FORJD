import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';

/**
 * Phase 10L (decision D8): where the data behind the city leaderboard comes from.
 *
 * This page is a licence obligation, not decoration. GeoNames is CC BY 4.0, which requires
 * attribution, a link to the licence and an indication that the data was changed, all visible to
 * the people who use it. It must ship before any store build that includes the leaderboard.
 *
 * It is also where the score's published basis is stated, because the leaderboard ranks people
 * and a ranking should say what it is measured against. The wording is deliberate: the Activity
 * score is a participation measure against published targets, not a health or fitness
 * assessment, and it is a calculation, so it is never called AI (ADR-030, ADR-046).
 *
 * The prototype has no such screen, so the layout reuses the app's own header, section label and
 * card treatment rather than inventing new chrome.
 */
const GEONAMES_URL = 'https://www.geonames.org/';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';

interface SourceCardProps {
  title: string;
  children: ReactNode;
}

function SourceCard({ title, children }: SourceCardProps) {
  return (
    <View className="mt-[12px] rounded-card border border-border bg-surface px-4 py-[15px]">
      <Text className="font-archivo text-[15px] font-bold text-text">{title}</Text>
      {children}
    </View>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <Text className="mt-[7px] font-archivo text-[12.5px] leading-[1.5] text-dimmer">{children}</Text>
  );
}

interface LinkTextProps {
  label: string;
  accessibilityLabel: string;
  url: string;
}

function LinkText({ label, accessibilityLabel, url }: LinkTextProps) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      onPress={() => void Linking.openURL(url)}
      className="mt-[10px] self-start">
      <Text className="font-archivo text-[12.5px] font-semibold text-accent">{label}</Text>
    </Pressable>
  );
}

export default function DataSourcesScreen() {
  return (
    <ScreenBackground>
      <Header title="Data sources" onBack={() => router.replace('/profile')} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <Text className="font-archivo text-[13px] leading-[1.5] text-dim">
          What the city leaderboard is built from, and who we credit for it.
        </Text>

        <Text className="mb-[2px] mt-6 font-archivo text-section-label font-semibold uppercase text-label">
          Cities
        </Text>
        <SourceCard title="GeoNames">
          <Body>
            City names, positions and time zones come from the GeoNames gazetteer, licensed under
            Creative Commons Attribution 4.0 (CC BY 4.0). We filtered the list to cities of about
            15,000 people or more and grouped nearby districts under their main city, so the data
            here has been changed from the original.
          </Body>
          <Body>
            Your approximate position is matched to the nearest city on our own server. Your exact
            location is never stored.
          </Body>
          <LinkText
            label="geonames.org"
            accessibilityLabel="Open the GeoNames website"
            url={GEONAMES_URL}
          />
          <LinkText
            label="CC BY 4.0 licence"
            accessibilityLabel="Read the CC BY 4.0 licence"
            url={CC_BY_URL}
          />
        </SourceCard>

        <Text className="mb-[2px] mt-6 font-archivo text-section-label font-semibold uppercase text-label">
          Activity score
        </Text>
        <SourceCard title="World Health Organization">
          <Body>
            The Activity score measures your training against the World Health Organization’s 2020
            adult guidelines: 150 to 300 minutes of activity a week, and muscle-strengthening on
            two or more days. The rest of the score compares the weight you lift, the distance you
            cover and the time you train with other athletes in your city.
          </Body>
          <Body>
            It is a way to compare training, not a health or fitness assessment, and it says
            nothing about what you should do next.
          </Body>
        </SourceCard>
      </ScrollView>

      <TabBar active="profile" />
    </ScreenBackground>
  );
}
