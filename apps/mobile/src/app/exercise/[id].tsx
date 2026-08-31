import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { recordExerciseOpened } from '@/store/recent-exercises';

/**
 * Routing scaffolding only — the real exercise detail screen
 * (`docs/design/phase2-screen-specs.md` §4-5) is Phase J. This exists so `library.tsx`'s row
 * tap (Phase I) has somewhere real to land instead of a dead "unmatched route" screen, the
 * same reason `(tabs)/train.tsx` shipped as a bare `PlaceholderScreen` before its own phase
 * built it out.
 *
 * It does one real thing already: recording the open. `recent-exercises.ts`'s whole point is
 * to back the library's `Recent` section with a genuine last-opened signal rather than the
 * prototype's `all.slice(0,3)` stand-in, and that only becomes true end-to-end once
 * *something* calls `recordExerciseOpened` — there is no reason to wait for Phase J's full
 * screen to wire the one line that makes it real.
 */
export default function ExerciseDetailPlaceholderScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  useEffect(() => {
    if (typeof id === 'string') {
      void recordExerciseOpened(id);
    }
  }, [id]);

  return (
    <ScreenBackground>
      <Header title="Exercise" onBack={() => router.replace('/library')} />
      <View className="flex-1 items-center justify-center">
        <Text className="font-archivo text-screen-header font-bold text-text">
          exercise detail — coming soon
        </Text>
      </View>
      <TabBar active="train" />
    </ScreenBackground>
  );
}
