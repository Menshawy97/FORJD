import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/**
 * Home's primary call to action.
 *
 * The prototype's handler (`goSuggested`, FORJD Mobile.dc.html line 1150) is:
 *
 *   if (activeProgram) { openProgram(activeProgram) } else { screen: 'train' }
 *
 * -- open the program the user is following, or fall through to the Train landing screen.
 * There are no programs in this app yet (Phase 3), so no user can have an active one and
 * every tap takes the fallback branch today. The program branch is not stubbed here: it
 * lands with the programs slice of Phase 3, which is also what will give `programOverview` a
 * route to open.
 */
interface StartWorkoutCtaProps {
  onPress: () => void;
}

export function StartWorkoutCta({ onPress }: StartWorkoutCtaProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      // R19 (H13): white `onAccent` text on the raw `accent` fill measured 3.06:1, below AA's
      // 4.5:1 floor -- darkened to `accentDark`. The ambient `shadow-accent-hero-card` glow is
      // left at its original accent-orange colour: it's a soft, blurred halo outside the button
      // shape, not a surface under text, so it carries no contrast requirement of its own.
      className="my-card-gap flex-row items-center justify-between rounded-[15px] bg-accentDark px-4 py-[15px] shadow-accent-hero-card">
      <Text className="font-archivo text-cta-title font-bold text-onAccent">Start Workout</Text>
      <View className="h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-ctaArrowTileBg">
        <Icon name="arrowRight" size={20} color={colors.onAccent} />
      </View>
    </Pressable>
  );
}
