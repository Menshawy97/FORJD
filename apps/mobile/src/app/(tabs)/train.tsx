import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { colors } from '@/theme/tokens';

/**
 * `s_train()`'s quick-action row (line 2434), the only part of Train Phase 2 builds —
 * `docs/design/phase2-screen-specs.md` §9. Everything else on the real Train screen (Follow
 * a Program, My Programs, Previous Workout, My Workouts) needs Phase 3/4 data that does not
 * exist yet, so it stays a bare placeholder message below the two cards rather than being
 * built against nothing.
 *
 * `Start a run` targets a Phase 3 screen that does not exist — rendered per §9's own
 * instruction ("render the card, route it nowhere yet"), so it is not wired to `onPress` at
 * all. `Exercise library` is real: it is `library.tsx`, shipped this same phase.
 */
const QUICK_ACTIONS: ReadonlyArray<{ key: string; label: string; icon: IconName; href: '/library' | null }> = [
  { key: 'run', label: 'Start a run', icon: 'runner', href: null },
  { key: 'library', label: 'Exercise library', icon: 'dumb', href: '/library' },
];

export default function TrainScreen() {
  return (
    <ScreenBackground className="px-screen-x">
      <Text className="pt-[2px] font-archivo text-screen-header font-bold text-text">Train</Text>

      <View className="mt-4 flex-row" style={{ gap: 8 }}>
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            disabled={action.href === null}
            onPress={action.href ? () => router.push(action.href as '/library') : undefined}
            className="min-w-0 flex-1 flex-row items-center gap-[9px] rounded-card border border-border bg-surface px-[13px] py-[11px]"
            style={({ pressed }) => (pressed ? { borderColor: 'rgba(233,113,47,.4)' } : null)}>
            <Icon name={action.icon} size={18} color={colors.metadata} />
            <Text
              className="font-archivo text-[12.5px] font-semibold leading-[1.15] text-text"
              style={{ minWidth: 0 }}
              numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="flex-1 items-center justify-center">
        <Text className="font-archivo text-[13px] text-dimmer">
          programs, previous workouts, and my workouts — coming soon
        </Text>
      </View>
    </ScreenBackground>
  );
}
