import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { updatePrivacy } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Icon } from '@/components/icon';
import { pressGhost, pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { colors } from '@/theme/tokens';

// ADR-043 (Phase 8). Shown before FORJD collects any health data -- connecting WHOOP today,
// Health Connect / Apple Health when those ship -- and separate from the generic app
// permissions. The prototype has no consent screen of its own, so this reuses the layout of
// its nearest permission explainer, `s_location()` (see location.tsx): icon tile, heading,
// intro, three-or-four question/answer pairs, then a primary and a ghost button. No design
// screenshot exists for it; the copy is a draft for the lawyer's review of the privacy policy.
//
// Deliberately no tab bar: this is a decision moment reached from Connect, not a tab
// destination, and it must not be possible to wander off mid-decision.
const QA: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'What is collected?',
    a: 'Only what you connect: for example recovery, sleep, heart rate and workouts from WHOOP.',
  },
  {
    q: 'Who sees it?',
    a: 'Only you. It is never sold, shared with advertisers, or sent to analytics services.',
  },
  {
    q: 'What if you decline?',
    a: 'Nothing is collected. Training, nutrition and body scans work as usual.',
  },
  {
    q: 'Can you change your mind?',
    a: 'Yes. Turn it off in Privacy Settings at any time. Data already collected stays until you disconnect or delete your account.',
  },
];

function describeFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not save your choice. Please try again.';
}

export default function HealthConsentScreen() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = () => router.replace('/connect');

  const handleAllow = async () => {
    setError(null);
    setSaving(true);
    try {
      await updatePrivacy({ healthDataConsent: true });
      goBack();
    } catch (cause) {
      setError(describeFailure(cause));
      setSaving(false);
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
          <Icon name="heart" color={colors.textSecondary} size={22} />
        </View>

        <Text
          className="mt-5 font-archivo text-[24px] font-bold leading-[1.2] text-text"
          style={{ letterSpacing: -0.02 * 24 }}>
          Use your health data?
        </Text>
        <Text className="mb-6 mt-3 font-archivo text-[13px] leading-[1.55] text-dim">
          FORJD can bring in data from WHOOP and your health apps to build your readiness score
          and progress. Nothing is collected until you say yes.
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
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={handleAllow}
            style={pressScale}
            // R19 (H13): white text on raw `accent` measured 3.06:1, below AA's 4.5:1 floor.
            className="h-[52px] items-center justify-center rounded-button bg-accentDark shadow-primary-button">
            <Text className="font-archivo text-button font-bold text-white">Allow</Text>
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
    </ScreenBackground>
  );
}
