import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { pressGhost, pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { colors } from '@/theme/tokens';

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
