import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { consumeSessionExpired } from '@/auth/secureStorage';
import { Icon, type IconName } from '@/components/icon';
import { pressGhost, pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { colors } from '@/theme/tokens';

/**
 * `/welcome` is where `_layout.tsx`'s `AuthGate` lands *every* authenticated route once the
 * session is gone (ADR-011) — including the forced sign-out `apiClient`'s response
 * interceptor triggers when a 401-triggered token refresh itself fails. Until now that
 * redirect carried no explanation: the screen the user was on showed its own generic error
 * (e.g. builder.tsx's "Could not save this workout"), then vanished with no indication the
 * session had actually been wiped. `consumeSessionExpired()` is the one-shot flag
 * `clearSession({ expired: true })` sets for exactly this case — read once here, on mount,
 * so a later ordinary visit to /welcome (app launch, manual logout) never shows it.
 */
const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please log in again.';

// Copy, layout and glyphs from the prototype's welcome screen (`isWelcome` branch of
// `FORJD mobile app design/FORJD Mobile.dc.html`), cross-checked against
// 01-screen-inventory.md.
//
// Vertical rhythm is the prototype's, and it is deliberately NOT `justify-center`: a fixed
// 70px top spacer, content, then a flexible spacer that pushes the two CTAs to the bottom.
// Centering the whole column (what this screen used to do) collapses that rhythm.
const FEATURES: Array<{ icon: IconName; text: string }> = [
  { icon: 'bolt', text: 'Strength · Running · Cross Training · Mobility' },
  { icon: 'heart', text: 'Sleep · HRV · Recovery · Body Composition' },
  // The prototype inlines the bar-chart mark here (not the `progress` glyph the fidelity
  // spec's summary names) — prototype wins.
  { icon: 'bars', text: 'AI Insights · City Leaderboards · Analytics' },
];

const FEATURE_ICON_SIZE = 19;

/** The four-bar chart mark beside the wordmark: 5.5px bars, heights 11/26/9/20, 3px gap. */
const WORDMARK_BARS: Array<{ height: number; color: string }> = [
  { height: 11, color: colors.accent },
  { height: 26, color: colors.accent },
  { height: 9, color: colors.accentDark },
  { height: 20, color: colors.accent },
];

export default function WelcomeScreen() {
  // Lazy initializer: this must consume the flag exactly once, at mount, not on every
  // render -- a `useState(consumeSessionExpired())` call form would re-invoke it whenever
  // React re-renders this component for an unrelated reason before it re-mounts.
  const [sessionExpired] = useState(() => consumeSessionExpired());

  return (
    <ScreenBackground>
      <View className="flex-1 px-welcome-x pb-10">
        <View style={{ height: 70 }} />

        <View className="flex-row items-center" style={{ gap: 11 }}>
          <View className="flex-row items-end" style={{ height: 26, gap: 3 }}>
            {WORDMARK_BARS.map((bar, index) => (
              <View
                key={index}
                style={{
                  width: 5.5,
                  height: bar.height,
                  backgroundColor: bar.color,
                  borderRadius: 1.5,
                }}
              />
            ))}
          </View>
          <Text className="font-archivo text-wordmark-welcome font-extrabold text-text">FORJD</Text>
        </View>

        <Text className="mt-[34px] font-archivo text-welcome-headline font-bold text-text">
          {'Training.\nRecovery.\nProgress.'}
        </Text>
        <Text className="mt-4 font-archivo text-welcome-sub text-dim" style={{ maxWidth: 290 }}>
          One place for everything your body is doing.
        </Text>

        <View className="mt-[34px]">
          {FEATURES.map((feature) => (
            <View
              key={feature.icon}
              className="flex-row items-center border-t border-border py-[15px]"
              style={{ gap: 13 }}>
              <Icon name={feature.icon} size={FEATURE_ICON_SIZE} color={colors.accent} />
              <Text className="flex-1 font-archivo text-welcome-feature font-medium text-welcomeFeature">
                {feature.text}
              </Text>
            </View>
          ))}
        </View>

        <View className="min-h-[24px] flex-1" />

        {sessionExpired && (
          <Text className="mb-3 font-archivo text-inline-error font-medium text-errorText">
            {SESSION_EXPIRED_MESSAGE}
          </Text>
        )}

        <View className="gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create Account"
            onPress={() => router.push('/signup')}
            style={pressScale}
            className="h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
            <Text className="font-archivo text-button font-bold text-white">Create Account</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log In"
            onPress={() => router.push('/login')}
            style={pressGhost}
            className="h-[52px] items-center justify-center rounded-button border border-border">
            {/* The label brightens with the fill — `btn('ghost')` changes both together, and
                only the render-prop form can see `pressed`. */}
            {({ pressed }) => (
              <Text
                className={`font-archivo text-button font-semibold ${
                  pressed ? 'text-text' : 'text-dim'
                }`}>
                Log In
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </ScreenBackground>
  );
}
