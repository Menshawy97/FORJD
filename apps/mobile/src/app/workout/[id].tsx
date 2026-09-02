import type { ExerciseResponse, WorkoutTemplateResponse } from '@forjd/contracts';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getWorkoutTemplate } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { TypeChip } from '@/components/type-chip';
import { getCachedExercise, openExerciseCatalogueDb } from '@/store/exercise-catalogue';
import { setBuilderPrefill } from '@/workouts/builder-handoff';
import { colors } from '@/theme/tokens';

/**
 * `s_workoutDetail()`. **No reference screenshot exists for this screen** -- per the standing
 * design precedence (screenshots first, then the prototype, then specs), the prototype's own
 * `s_workoutDetail()` source is authoritative here instead, matched line for line: header with
 * the template's name, a type/meta row, a read-only exercise list ("name" + "sets×reps"), and
 * two CTAs -- "Start workout" (Phase H, not built yet) and "Customise" (this phase's own
 * write path). `TabBar` is present, unlike `builder.tsx` -- the prototype's `s_workoutDetail`
 * ends with `this.tabbar('train')`, `s_builder` does not.
 *
 * **Exercise names are resolved from the on-device catalogue, not the server response.**
 * `workoutExerciseResponseSchema` carries only `exerciseId` -- the exercise library's own
 * data (name, measure) already lives in `exercises_cache` from ADR-022's sync, offline and
 * with no extra round trip, so this screen reads it from there via `getCachedExercise`
 * rather than growing the workout response with a second copy of exercise fields the
 * catalogue already owns.
 */

interface DisplayRow {
  exerciseId: string;
  name: string;
  measure: ExerciseResponse['measure'] | null;
  setCount: number | null;
  targetLabel: string;
}

function targetLabelOf(exercise: WorkoutTemplateResponse['blocks'][number]['exercises'][number]): string {
  if (exercise.targetSeconds !== null) return `${exercise.targetSeconds} s`;
  if (exercise.targetDistanceMeters !== null) return `${exercise.targetDistanceMeters} m`;
  if (exercise.targetReps !== null) return `${exercise.targetReps} reps`;
  return '—';
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [template, setTemplate] = useState<WorkoutTemplateResponse | null>(null);
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const found = await getWorkoutTemplate(id);
          if (cancelled) return;
          setTemplate(found);

          const db = await openExerciseCatalogueDb();
          const flatExercises = found.blocks.flatMap((block) => block.exercises);
          const resolved = await Promise.all(
            flatExercises.map(async (exercise) => {
              const cached = await getCachedExercise(db, exercise.exerciseId);
              return {
                exerciseId: exercise.exerciseId,
                name: cached?.name ?? 'Exercise',
                measure: cached?.measure ?? null,
                setCount: exercise.setCount,
                targetLabel: targetLabelOf(exercise),
              };
            }),
          );
          if (!cancelled) setRows(resolved);
        } catch (cause) {
          if (!cancelled) {
            setError(
              classifyRequestFailure(cause) === 'offline'
                ? OFFLINE_MESSAGE
                : 'Could not load this workout.',
            );
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const onCustomise = () => {
    if (!template) return;
    setBuilderPrefill({
      basedOnTemplateId: template.id,
      name: template.name,
      activity: template.activity,
      exercises: template.blocks.flatMap((block) =>
        block.exercises.map((exercise) => {
          const resolved = rows.find((row) => row.exerciseId === exercise.exerciseId);
          return {
            exerciseId: exercise.exerciseId,
            name: resolved?.name ?? 'Exercise',
            measure: resolved?.measure ?? 'weight',
            setCount: exercise.setCount ?? 3,
            targetReps: exercise.targetReps,
            targetSeconds: exercise.targetSeconds,
            targetDistanceMeters: exercise.targetDistanceMeters,
          };
        }),
      ),
    });
    router.push('/builder');
  };

  return (
    <ScreenBackground>
      <Header title={template?.name ?? 'Workout'} onBack={() => router.back()} />

      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        {error ? (
          <Text className="mt-6 font-archivo text-[13px] text-dimmer">{error}</Text>
        ) : !template ? (
          <Text className="mt-6 font-archivo text-[13px] text-dimmer">Loading…</Text>
        ) : (
          <>
            <View className="mb-4 flex-row items-center" style={{ gap: 8 }}>
              <TypeChip
                kind={!template.isCustom ? 'Preset' : template.basedOnTemplateId ? 'Customised preset' : 'Custom'}
              />
              <Text className="font-archivo text-[11.5px] text-dimmer">
                {template.activity.charAt(0).toUpperCase() + template.activity.slice(1)} · {rows.length} exercises
                {template.estimatedDurationMinutes ? ` · ~${template.estimatedDurationMinutes} min` : ''}
              </Text>
            </View>

            <Text className="mb-[10px] font-archivo text-section-label font-semibold uppercase text-label">
              Exercises
            </Text>
            <View
              className="rounded-card px-[15px] py-[4px]"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              {rows.map((row, index) => (
                <View
                  key={`${row.exerciseId}-${index}`}
                  className="flex-row items-center py-[11px]"
                  style={index < rows.length - 1 ? { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.05)', gap: 11 } : { gap: 11 }}>
                  <Text className="flex-1 font-archivo text-row-title font-semibold text-text" numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text className="font-archivo text-[12px] font-medium text-dimmer">
                    {row.setCount ?? 1}×{row.targetLabel}
                  </Text>
                </View>
              ))}
            </View>

            <View className="mt-6" style={{ gap: 10 }}>
              <View className="h-[52px] items-center justify-center rounded-[12px]" style={{ backgroundColor: colors.accent, opacity: 0.5 }}>
                <Text className="font-archivo text-[14.5px] font-bold text-white">Start workout</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Customise"
                onPress={onCustomise}
                className="h-[52px] items-center justify-center rounded-[12px]"
                style={{ borderWidth: 1, borderColor: colors.border }}>
                <Text className="font-archivo text-[14px] font-semibold text-dim">Customise</Text>
              </Pressable>
            </View>
          </>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      <TabBar active="train" />
    </ScreenBackground>
  );
}
