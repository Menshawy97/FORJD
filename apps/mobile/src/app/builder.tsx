import { EXERCISE_MEASURE_DISPLAY_NAMES } from '@forjd/domain';
import type { CreateWorkoutTemplateRequest } from '@forjd/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { createWorkoutTemplate } from '@/auth/apiClient';
import { actionableServerMessage, classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { TypeChip } from '@/components/type-chip';
import {
  consumeBuilderPrefill,
  consumePickedExerciseForBuilder,
  type BuilderExerciseDraft,
} from '@/workouts/builder-handoff';
import { colors } from '@/theme/tokens';

/**
 * `s_builder()`, matched against `workout custom.png` (the exact reference screenshot, not
 * the prototype's own styling, per the user's own standing instruction to treat the
 * screenshots as the authoritative UI). No `TabBar` here -- the prototype's own `s_builder`
 * never calls `this.tabbar(...)`, unlike `s_workoutDetail`'s explicit `this.tabbar('train')`,
 * matching this app's own `new-exercise.tsx` (no tab bar) vs `exercise/[id].tsx` (has one)
 * precedent for the same create-vs-detail distinction.
 *
 * **Only creates.** The prototype has no in-place "edit an existing workout" affordance --
 * every visit to the builder either starts from scratch or copies a source template's data
 * into local state via `Customise` (`workout/[id].tsx`), and only the final "Save workout"
 * tap ever reaches the server, as one `POST /workouts/templates`. There is deliberately no
 * `PATCH` call from this screen.
 *
 * **The second stepper's field follows the exercise's own `measure`** -- `weight` prescribes
 * reps, `time` prescribes a duration, `distance` prescribes a distance, mirroring
 * `Exercise.measure`'s role as the one discriminator the whole engine reads (never a second
 * one invented here). The screenshot only shows the weight/reps case (Bench Press, Deadlift,
 * Back Squat); the other two measures are this screen's own generalisation of that same row,
 * since the library it adds exercises from serves all three.
 *
 * **"Start now" renders inert** -- the prototype's own live-execution destination is Phase H,
 * which does not exist yet, the same "render the card, route it nowhere yet" precedent
 * `train.tsx`'s own "Start a run" quick action already established.
 */

const STEP_BY_MEASURE: Record<BuilderExerciseDraft['measure'], number> = {
  weight: 1,
  time: 15,
  distance: 50,
};

const LABEL_BY_MEASURE: Record<BuilderExerciseDraft['measure'], string> = {
  weight: 'Reps',
  time: 'Duration (s)',
  distance: 'Distance (m)',
};

function targetOf(exercise: BuilderExerciseDraft): number {
  if (exercise.measure === 'time') return exercise.targetSeconds ?? 45;
  if (exercise.measure === 'distance') return exercise.targetDistanceMeters ?? 500;
  return exercise.targetReps ?? 10;
}

function withTarget(exercise: BuilderExerciseDraft, value: number): BuilderExerciseDraft {
  if (exercise.measure === 'time') return { ...exercise, targetSeconds: value };
  if (exercise.measure === 'distance') return { ...exercise, targetDistanceMeters: value };
  return { ...exercise, targetReps: value };
}

function toRequestBody(
  name: string,
  basedOnTemplateId: string | null,
  exercises: BuilderExerciseDraft[],
): CreateWorkoutTemplateRequest {
  return {
    name: name.trim(),
    activity: 'strength',
    ...(basedOnTemplateId ? { basedOnTemplateId } : {}),
    blocks: [
      {
        type: 'straight_sets',
        exercises: exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          setCount: exercise.setCount,
          targetReps: exercise.targetReps ?? undefined,
          targetSeconds: exercise.targetSeconds ?? undefined,
          targetDistanceMeters: exercise.targetDistanceMeters ?? undefined,
        })),
      },
    ],
  };
}

export default function BuilderScreen() {
  const [name, setName] = useState('');
  const [basedOnTemplateId, setBasedOnTemplateId] = useState<string | null>(null);
  const [exercises, setExercises] = useState<BuilderExerciseDraft[]>([]);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // Consumes a prefill (from `workout/[id].tsx`'s Customise) once, on first mount only -- a
  // later refocus (e.g. returning from the library picker) must never re-apply it and wipe
  // out exercises the user has since added or edited.
  useState(() => {
    const prefill = consumeBuilderPrefill();
    if (prefill) {
      setName(prefill.name);
      setBasedOnTemplateId(prefill.basedOnTemplateId);
      setExercises(prefill.exercises);
    }
  });

  useFocusEffect(
    useCallback(() => {
      const picked = consumePickedExerciseForBuilder();
      if (picked) {
        setExercises((current) => [
          ...current,
          {
            exerciseId: picked.exerciseId,
            name: picked.name,
            measure: picked.measure,
            setCount: 3,
            targetReps: picked.measure === 'weight' ? 10 : null,
            targetSeconds: picked.measure === 'time' ? 45 : null,
            targetDistanceMeters: picked.measure === 'distance' ? 500 : null,
          },
        ]);
      }
    }, []),
  );

  const removeExercise = (index: number) => {
    setExercises((current) => current.filter((_, i) => i !== index));
  };

  const updateExercise = (index: number, patch: Partial<BuilderExerciseDraft>) => {
    setExercises((current) => current.map((exercise, i) => (i === index ? { ...exercise, ...patch } : exercise)));
  };

  const isValid = name.trim().length > 0 && exercises.length > 0;

  const save = async () => {
    if (!isValid) {
      setTriedSubmit(true);
      return;
    }
    setSaving(true);
    try {
      await createWorkoutTemplate(toRequestBody(name, basedOnTemplateId, exercises));
      router.back();
    } catch (cause) {
      toast.show(
        classifyRequestFailure(cause) === 'offline'
          ? OFFLINE_MESSAGE
          : (actionableServerMessage(cause) ?? 'Could not save this workout. Please try again.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const validationMessage = !name.trim() && exercises.length === 0
    ? 'Add a name and at least one exercise before saving or starting.'
    : !name.trim()
      ? 'Give this workout a name before saving.'
      : 'Add at least one exercise before saving or starting.';

  return (
    <ScreenBackground>
      <Header title="Workout builder" onBack={() => router.back()} />

      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        <Text className="mb-[9px] font-archivo text-section-label font-semibold uppercase text-label">
          Workout name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          className="h-[50px] rounded-field px-[15px] font-archivo text-[14.5px] font-semibold text-text"
          style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border }}
        />

        <View className="mt-[10px] flex-row items-center" style={{ gap: 9 }}>
          <TypeChip kind={basedOnTemplateId ? 'Customised preset' : 'Custom'} />
          <Text className="font-archivo text-[11.5px] text-dimmer">
            {basedOnTemplateId ? 'Based on a preset' : 'Built from scratch'}
          </Text>
        </View>

        <Text className="mb-[10px] mt-6 font-archivo text-section-label font-semibold uppercase text-label">
          Exercises
        </Text>

        <View className="rounded-card px-[15px] pt-[4px] pb-[15px]" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          {exercises.map((exercise, index) => (
            <View
              key={`${exercise.exerciseId}-${index}`}
              className="py-[12px]"
              style={index < exercises.length - 1 ? { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.05)' } : undefined}>
              <View className="flex-row items-center" style={{ gap: 11 }}>
                <Text className="flex-1 font-archivo text-row-title font-semibold text-text">{exercise.name}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${exercise.name}`}
                  onPress={() => removeExercise(index)}
                  hitSlop={8}>
                  <Icon name="x" size={16} color={colors.errorText} />
                </Pressable>
              </View>

              <View className="mt-[10px] flex-row" style={{ gap: 8 }}>
                <View
                  className="flex-row items-center rounded-[9px] px-[10px] py-[7px]"
                  style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
                  <Text className="font-archivo text-[10.5px] font-medium text-dimmer">Sets</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease sets"
                    onPress={() => updateExercise(index, { setCount: Math.max(1, exercise.setCount - 1) })}>
                    <Text className="font-archivo text-[14px] font-bold text-dim">−</Text>
                  </Pressable>
                  <Text className="w-[14px] text-center font-archivo text-[13px] font-bold text-text">
                    {exercise.setCount}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase sets"
                    onPress={() => updateExercise(index, { setCount: exercise.setCount + 1 })}>
                    <Text className="font-archivo text-[14px] font-bold text-dim">+</Text>
                  </Pressable>
                </View>

                <View
                  className="flex-row items-center rounded-[9px] px-[10px] py-[7px]"
                  style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
                  <Text className="font-archivo text-[10.5px] font-medium text-dimmer">
                    {LABEL_BY_MEASURE[exercise.measure]}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Decrease ${EXERCISE_MEASURE_DISPLAY_NAMES[exercise.measure].toLowerCase()}`}
                    onPress={() =>
                      updateExercise(index, withTarget(exercise, Math.max(1, targetOf(exercise) - STEP_BY_MEASURE[exercise.measure])))
                    }>
                    <Text className="font-archivo text-[14px] font-bold text-dim">−</Text>
                  </Pressable>
                  <Text className="w-[30px] text-center font-archivo text-[13px] font-bold text-text">
                    {targetOf(exercise)}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Increase ${EXERCISE_MEASURE_DISPLAY_NAMES[exercise.measure].toLowerCase()}`}
                    onPress={() =>
                      updateExercise(index, withTarget(exercise, targetOf(exercise) + STEP_BY_MEASURE[exercise.measure]))
                    }>
                    <Text className="font-archivo text-[14px] font-bold text-dim">+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add exercise"
            onPress={() => router.push('/library?pick=builder')}
            className="mt-[12px] h-[44px] flex-row items-center justify-center rounded-[10px]"
            style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(233,113,47,.45)', backgroundColor: 'rgba(233,113,47,.06)', gap: 8 }}>
            <Icon name="plus" size={16} color={colors.accent} />
            <Text className="font-archivo text-[13px] font-bold text-accent">Add exercise</Text>
          </Pressable>
        </View>

        {triedSubmit && !isValid ? (
          <View
            className="mt-[14px] flex-row items-center rounded-[11px] px-[14px] py-[12px]"
            style={{ backgroundColor: 'rgba(201,80,60,.09)', borderWidth: 1, borderColor: 'rgba(201,80,60,.32)', gap: 9 }}>
            <Text className="flex-1 font-archivo text-[11.5px] font-semibold" style={{ color: '#e0796a' }}>
              {validationMessage}
            </Text>
          </View>
        ) : null}

        <View style={{ height: 24 }} />
      </ScrollView>

      <View
        className="flex-none flex-row px-screen-x pb-6 pt-[12px]"
        style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.06)', gap: 9 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save workout"
          disabled={saving}
          onPress={save}
          className="h-[52px] flex-1 items-center justify-center rounded-[12px]"
          style={{ backgroundColor: colors.accent, opacity: isValid ? 1 : 0.5 }}>
          <Text className="font-archivo text-[14.5px] font-bold text-white">
            {saving ? 'Saving…' : 'Save workout'}
          </Text>
        </Pressable>
        <View
          className="h-[52px] w-[104px] items-center justify-center rounded-[12px]"
          style={{ borderWidth: 1, borderColor: colors.border, opacity: exercises.length ? 1 : 0.5 }}>
          <Text className="font-archivo text-[13.5px] font-semibold text-dim">Start now</Text>
        </View>
      </View>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
