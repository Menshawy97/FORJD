import type { WorkoutTemplateSummary } from '@forjd/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { listWorkoutTemplates } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Icon, type IconName } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { TypeChip } from '@/components/type-chip';
import { colors } from '@/theme/tokens';

/**
 * `s_train()` / `train2.png`. Phase 2 shipped only the quick-action row
 * (`docs/design/phase2-screen-specs.md` §9); **Phase 3J adds My Workouts**, which is what
 * finally gives a saved workout somewhere to be seen — the builder had been writing templates
 * the app could never list back, flagged in the roadmap since Phase G.
 *
 * Still to come from the screenshot: the **Previous Workout** card (needs the session list
 * read) and the **programs** sections (Phase 3K). The header's favourites star is still
 * omitted — nothing backs a workout-favourites feature yet.
 *
 * `Start a run` targets a Phase 3 screen that does not exist — rendered per §9's own
 * instruction ("render the card, route it nowhere yet"), so it is not wired to `onPress` at
 * all. `Exercise library` is real: it is `library.tsx`, shipped this same phase.
 *
 * **The header "+" button** (`train1.png`) is Phase 3G's own minimal, screenshot-faithful
 * addition -- the one real entry point to `/builder` this phase ships. The header's other
 * control, the favourites star, is deliberately omitted: nothing backs a workout-favourites
 * feature yet, and the "My Workouts" list this button's own results would populate is
 * explicitly Phase J's job, not this one's.
 */
const QUICK_ACTIONS: ReadonlyArray<{ key: string; label: string; icon: IconName; href: '/library' | null }> = [
  { key: 'run', label: 'Start a run', icon: 'runner', href: null },
  { key: 'library', label: 'Exercise library', icon: 'dumb', href: '/library' },
];

export default function TrainScreen() {
  const [templates, setTemplates] = useState<WorkoutTemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reloaded on focus, not just on mount: returning from the builder having just saved a
  // workout must show it, and returning from `workout/[id]` after a delete must not.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const response = await listWorkoutTemplates();
          if (!cancelled) {
            setTemplates(response.items);
            setError(null);
          }
        } catch (cause) {
          if (!cancelled) {
            setError(
              classifyRequestFailure(cause) === 'offline' ? OFFLINE_MESSAGE : 'Could not load your workouts.',
            );
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <ScreenBackground className="px-screen-x">
      <View className="flex-row items-center justify-between pt-[2px]">
        <Text className="font-archivo text-screen-header font-bold text-text">Train</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New workout"
          onPress={() => router.push('/builder')}
          className="h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-accent">
          <Icon name="plus" size={18} color="#fff" />
        </Pressable>
      </View>

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

      {/*
        MY WORKOUTS -- `train2.png`. Until now a saved workout had nowhere to be seen: the
        builder wrote templates the app could never list back, which the roadmap had flagged
        since Phase G. Programs and Previous Workout are still to come.
      */}
      <View className="mt-6 flex-row items-center justify-between">
        <Text
          className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
          style={{ color: '#77776F' }}>
          My workouts
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New workout link"
          onPress={() => router.push('/builder')}>
          <Text className="font-archivo text-[11.5px] font-bold text-accent">+ New workout</Text>
        </Pressable>
      </View>

      <ScrollView className="mt-[10px] flex-1" showsVerticalScrollIndicator={false}>
        {error ? (
          <Text className="mt-4 font-archivo text-[13px] text-dimmer">{error}</Text>
        ) : templates === null ? (
          <Text className="mt-4 font-archivo text-[13px] text-dimmer">Loading…</Text>
        ) : templates.length === 0 ? (
          <Text className="mt-4 font-archivo text-[13px] text-dimmer">
            No workouts yet. Tap + to build your first.
          </Text>
        ) : (
          templates.map((template) => (
            <View
              key={template.id}
              className="mb-[10px] rounded-card px-[16px] py-[15px]"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <View className="flex-row items-start justify-between" style={{ gap: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${template.name}`}
                  onPress={() => router.push(`/workout/${template.id}`)}
                  className="min-w-0 flex-1">
                  <Text className="font-archivo text-[15px] font-bold text-text" numberOfLines={1}>
                    {template.name}
                  </Text>
                  <View className="mt-[8px] flex-row">
                    <TypeChip
                      kind={
                        !template.isCustom ? 'Preset' : template.basedOnTemplateId ? 'Customised preset' : 'Custom'
                      }
                    />
                  </View>
                  <Text className="mt-[8px] font-archivo text-[11.5px]" style={{ color: '#6E6E66' }}>
                    {`${template.exerciseCount} exercises${
                      template.estimatedDurationMinutes ? ` · ~${template.estimatedDurationMinutes} min` : ''
                    }`}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Start ${template.name}`}
                  onPress={() => router.push(`/workout/${template.id}`)}>
                  <Text className="font-archivo text-[12.5px] font-bold text-accent">Start</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
        <View style={{ height: 16 }} />
      </ScrollView>
    </ScreenBackground>
  );
}
