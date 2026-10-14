import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { consumeUnderageNotice } from '@/auth/account-notice';
import { consumeSessionExpired } from '@/auth/secureStorage';
import { Icon, type IconName } from '@/components/icon';
import { pressGhost, pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { LogoMark } from '@/components/brand/logo-mark';
import { Wordmark } from '@/components/brand/wordmark';
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
// ADR-042: shown once after the "Your Profile" step turned an under-16 away and removed the
// account. Read-once, like the expired-session notice above.
const UNDERAGE_MESSAGE = 'You must be at least 16 to use FORJD. Your account has been removed.';

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
  // Not "AI Insights": FORJD Insight is rules-based (walk finding 8; owner's wording).
  { icon: 'bars', text: 'FORJD Insight · City Leaderboards · Analytics' },
];

const FEATURE_ICON_SIZE = 19;

export default function WelcomeScreen() {
  // Lazy initializer: this must consume the flag exactly once, at mount, not on every
  // render -- a `useState(consumeSessionExpired())` call form would re-invoke it whenever
  // React re-renders this component for an unrelated reason before it re-mounts.
  const [sessionExpired] = useState(() => consumeSessionExpired());
  const [underage] = useState(() => consumeUnderageNotice());

  return (
    <ScreenBackground>
      <View className="flex-1 px-welcome-x pb-10">
        <View style={{ height: 70 }} />

        {/* ADR-052's lockup, in the proportions of the FORJD Logo canvas's primary lockup
            (symbol 120 : wordmark 67 tall), sized to the old row's 26-30px height. */}
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <LogoMark size={30} />
          <Wordmark height={17} />
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
        {underage && (
          <Text className="mb-3 font-archivo text-inline-error font-medium text-errorText">
            {UNDERAGE_MESSAGE}
          </Text>
        )}

        <View className="gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create Account"
            onPress={() => router.push('/signup')}
            style={pressScale}
            // R19 (H13): white text on raw `accent` measured 3.06:1, below AA's 4.5:1 floor.
            className="h-[52px] items-center justify-center rounded-button bg-accentDark shadow-primary-button">
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
