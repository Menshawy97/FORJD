import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';

/**
 * Routing scaffolding only — the real custom-exercise create/edit screen
 * (`docs/design/phase2-screen-specs.md` §6) is Phase K. Same reasoning as
 * `exercise/[id].tsx`: `library.tsx`'s **New** pill (Phase I) needs somewhere real to
 * navigate rather than a dead route.
 */
export default function NewExercisePlaceholderScreen() {
  return (
    <ScreenBackground>
      <Header title="New Exercise" onBack={() => router.replace('/library')} />
      <View className="flex-1 items-center justify-center">
        <Text className="font-archivo text-screen-header font-bold text-text">
          new exercise — coming soon
        </Text>
      </View>
      <TabBar active="train" />
    </ScreenBackground>
  );
}
