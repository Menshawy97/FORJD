import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { updatePrivacy } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Icon } from '@/components/icon';
import { pressGhost, pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar, type TabId } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { requestCoarsePermission } from '@/integrations/location/location-provider';
import { rememberLocationConsent } from '@/store/leaderboard-consent';
import { colors } from '@/theme/tokens';

// docs/design/slice2-screen-specs.md §7. The one screen of the six with a bottom rule under
// its chevron and no `hdr()` — and the only one that shows the tab bar while living outside
// the `(tabs)` group (see tab-bar.tsx for why that needs its own component).
//
// Phase 10 (ADR-048) made this real. The prototype hard-coded "Alexandria", modelled no system
// permission prompt and no denied path (§7.4). Now "Allow Location" asks the system for
// foreground location, once, and on a yes records the person's consent (`leaderboardOptIn` and
// `locationForLeaderboard`, together: the server rejects the second without the first). It never
// writes a city: the server derives that from the coarse position each workout starts with.
//
// Two departures from the design, both because the prototype was wrong about what the app does.
// "When is it used?" no longer says "once during setup": the position is read at the start of
// each workout, after this one permission. And there is a real denied state, which the design
// does not draw, built from the screen's own inline-error style and its "Not Now" button.
const QA: ReadonlyArray<{ q: string; a: string }> = [
  { q: 'Why is location used?', a: 'To place you in the correct city leaderboard automatically.' },
  {
    q: 'When is it used?',
    a: 'When you start a workout. Never tracked in the background.',
  },
  {
    q: 'What if you decline?',
    a: 'You will not appear on any city leaderboard. Everything else in FORJD still works normally.',
  },
];

const DECLINED_MESSAGE =
  'Location is off for FORJD, so you will not appear on a city leaderboard. You can allow it any time in Settings.';
const UNAVAILABLE_MESSAGE = "Location isn't available in this version of the app.";

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
  const [declined, setDeclined] = useState(false);
  const toast = useToast();

  const toPrivacy = back === 'privacy';
  const destination: Href = toPrivacy ? '/privacy' : '/rank';
  const activeTab: TabId = toPrivacy ? 'profile' : 'rank';
  // Set once the person has left (Back, Not Now, or the screen unmounting). A request that is
  // still in flight then finishes quietly: it must not record consent the person walked away
  // from, or navigate them a second time.
  const left = useRef(false);
  useEffect(
    () => () => {
      left.current = true;
    },
    [],
  );
  const inFlight = useRef(false);

  const goBack = () => {
    left.current = true;
    router.replace(destination);
  };

  const handleAllow = async () => {
    // A ref, not `allowing`: two taps inside one frame both see the state as still false.
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setDeclined(false);
    setAllowing(true);
    try {
      // The one place the app asks the system for location. A denial, or a build without the
      // native module, records no consent and leaves the person here to choose what to do.
      const permission = await requestCoarsePermission();
      if (left.current) return;
      if (permission === 'denied') {
        setDeclined(true);
        setAllowing(false);
        return;
      }
      if (permission === 'unavailable') {
        setError(UNAVAILABLE_MESSAGE);
        setAllowing(false);
        return;
      }

      await updatePrivacy({ leaderboardOptIn: true, locationForLeaderboard: true });
      // The device's copy of the consent, so a workout can decide at its start, offline, whether
      // to read a position. Written only once the server has it, and even if the person has since
      // left: the consent was recorded either way.
      await rememberLocationConsent(true);
      if (left.current) return;
      toast.show('Location allowed');
      goBack();
    } catch (cause) {
      if (left.current) return;
      setError(describeFailure(cause));
      setAllowing(false);
    } finally {
      inFlight.current = false;
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

        {(error || declined) && (
          // `text-inline-error` sets a line height equal to its 12px size, which suits the short
          // one-liners it is used for elsewhere and would run these longer messages together.
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            className="mb-[10px] font-archivo text-inline-error font-medium leading-[17px] text-errorText">
            {error ?? DECLINED_MESSAGE}
          </Text>
        )}

        <View className="pb-[18px]" style={{ gap: 11 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: allowing }}
            disabled={allowing}
            onPress={handleAllow}
            style={pressScale}
            // R19 (H13): white text on raw `accent` measured 3.06:1, below AA's 4.5:1 floor.
            className="h-[52px] items-center justify-center rounded-button bg-accentDark shadow-primary-button">
            <Text className="font-archivo text-button font-bold text-white">Allow Location</Text>
          </Pressable>
          {declined && (
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openSettings()}
              style={pressGhost}
              className="h-[52px] items-center justify-center rounded-button border border-border">
              <Text className="font-archivo text-button font-semibold text-text">Open Settings</Text>
            </Pressable>
          )}
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
