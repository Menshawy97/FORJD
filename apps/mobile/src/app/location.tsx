import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { updateProfile } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Icon } from '@/components/icon';
import { pressGhost, pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar, type TabId } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

// docs/design/slice2-screen-specs.md §7. The one screen of the six with a bottom rule under
// its chevron and no `hdr()` — and the only one that shows the tab bar while living outside
// the `(tabs)` group (see tab-bar.tsx for why that needs its own component).
//
// The prototype hard-codes "Alexandria" and never sends coordinates — no OS location
// permission prompt is modelled, and no denied path exists (§7.4). Reproduced exactly: this
// screen writes a hard-coded city, not a real device location read. `priv.location` is
// deliberately NOT written from here — the spec calls this out explicitly as a prototype gap
// (§7.6), not a design decision, and closing it belongs to Phase I's `privacy` screen, which
// owns the leaderboardOptIn/locationForLeaderboard cascade.
const ASSIGNED_CITY = 'Alexandria';

const QA: ReadonlyArray<{ q: string; a: string }> = [
  { q: 'Why is location used?', a: 'To place you in the correct city leaderboard automatically.' },
  { q: 'When is it used?', a: 'Once during setup. Not tracked in the background.' },
  {
    q: 'What if you decline?',
    a: 'You will not appear on any city leaderboard. Everything else in FORJD still works normally.',
  },
];

function describeFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not update your location. Please try again.';
}

/** `locationReturnTo`, minus the navigation-stack state the spec says not to port (§7.6) — a
 * `back` query param carries just the one bit that actually matters: which screen sent us. */
export default function LocationScreen() {
  const { back } = useLocalSearchParams<{ back?: string }>();
  const [allowing, setAllowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // '/privacy' is not a registered route until Phase I builds that screen — this cast is the
  // honest way to say "this Href will resolve once that screen exists", not a blanket escape
  // hatch. Every other Href in this file stays fully typed.
  const toPrivacy = back === 'privacy';
  const destination: Href = toPrivacy ? ('/privacy' as Href) : '/rank';
  const activeTab: TabId = toPrivacy ? 'profile' : 'rank';
  const goBack = () => router.replace(destination);

  const handleAllow = async () => {
    setError(null);
    setAllowing(true);
    try {
      await updateProfile({ city: ASSIGNED_CITY });
      toast.show(`Assigned to ${ASSIGNED_CITY}`);
      goBack();
    } catch (cause) {
      setError(describeFailure(cause));
      setAllowing(false);
    }
  };

  return (
    <ScreenBackground>
      <View className="flex-none border-b border-border px-screen-x">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          className="h-[34px] w-[34px] items-center justify-center"
          style={{ marginBottom: 8, marginLeft: -8 }}>
          <Icon name="back" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-screen-x pt-[26px]"
        showsVerticalScrollIndicator={false}>
        <View
          className="h-[44px] w-[44px] items-center justify-center rounded-[12px]"
          style={{ backgroundColor: colors.elevated2 }}>
          <Icon name="pin" color={colors.textSecondary} size={22} />
        </View>

        <Text
          className="mt-5 font-archivo text-[24px] font-bold leading-[1.2] text-text"
          style={{ letterSpacing: -0.02 * 24 }}>
          City Leaderboard Location
        </Text>
        <Text className="mb-6 mt-3 font-archivo text-[13px] leading-[1.55] text-dim">
          FORJD uses your approximate location to assign you to a city leaderboard. Your
          precise location is never stored or shared.
        </Text>

        <View style={{ gap: 18 }}>
          {QA.map((item) => (
            <View key={item.q}>
              <Text className="font-archivo text-[13px] font-bold leading-[1.3] text-text">
                {item.q}
              </Text>
              <Text className="mt-[6px] font-archivo text-[12.5px] leading-[1.5] text-dimmer">
                {item.a}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ minHeight: 30 }} />

        {error && (
          <Text className="mb-[10px] font-archivo text-inline-error font-medium text-errorText">
            {error}
          </Text>
        )}

        <View className="pb-[18px]" style={{ gap: 11 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: allowing }}
            disabled={allowing}
            onPress={handleAllow}
            style={pressScale}
            className="h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
            <Text className="font-archivo text-button font-bold text-white">Allow Location</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={goBack}
            style={pressGhost}
            className="h-[52px] items-center justify-center rounded-button border border-border">
            {({ pressed }) => (
              <Text
                className={`font-archivo text-button font-semibold ${
                  pressed ? 'text-text' : 'text-dim'
                }`}>
                Not Now
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      <TabBar active={activeTab} />
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
