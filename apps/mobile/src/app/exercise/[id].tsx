import {
  EQUIPMENT_DISPLAY_NAMES,
  EXERCISE_GOAL_DISPLAY_NAMES,
  MUSCLE_GROUP_DISPLAY_NAMES,
} from '@forjd/domain';
import type { ExerciseResponse } from '@forjd/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { deleteExercise, getExerciseCatalogue, setExerciseFavourite } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import {
  ensureExerciseCatalogueSchema,
  getCachedExercise,
  openExerciseCatalogueDb,
  removeCachedExercise,
  setLocalFavourite,
  syncExerciseCatalogue,
  type SqliteConnection,
} from '@/store/exercise-catalogue';
import { recordExerciseOpened } from '@/store/recent-exercises';
import { colors } from '@/theme/tokens';

/**
 * `s_exercise()` / `s_exerciseRun()`, docs/design/phase2-screen-specs.md §4-5. The branch is
 * **by category, not by route** (§4, quoting the prototype: `if (meta[3] === 'Running') return
 * this.s_exerciseRun(tags)`) -- one route, `/exercise/[id]`, branching internally on
 * `category === 'running'`.
 *
 * Reads the on-device catalogue (Phase H), the same cache-first-then-background-sync pattern
 * `library.tsx` already established, rather than a fresh network call -- offline workout
 * execution (CLAUDE.md rule 6) needs the exercise available without a round trip, and Phase H's
 * sync endpoint already returns the full detail shape for exactly this reason.
 *
 * **Stat tiles, sparkline and history (§4.2 items 3-5, §5 items 2-6) are Phase 3 data and are
 * omitted entirely**, not rendered as zeros -- the same call already made for the athlete
 * screen's stat tiles and the library row's trailing stat. **Instructions are shown** (§8's
 * deviation list) even though the prototype has no field for them, because the ingested
 * dataset provides real ones and an exercise detail with nothing but tags would be thinner
 * than the design intends.
 */
export default function ExerciseDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [exercise, setExercise] = useState<ExerciseResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const toast = useToast();
  const dbRef = useRef<SqliteConnection | null>(null);

  const load = useCallback(async () => {
    const db = dbRef.current;
    if (!db || typeof id !== 'string') return;
    setExercise(await getCachedExercise(db, id));
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (typeof id === 'string') {
      void recordExerciseOpened(id);
    }

    (async () => {
      const db = await openExerciseCatalogueDb();
      if (cancelled) return;
      await ensureExerciseCatalogueSchema(db);
      dbRef.current = db;
      await load();
      setLoaded(true);

      try {
        const { synced } = await syncExerciseCatalogue(db, getExerciseCatalogue);
        if (!cancelled && synced) {
          await load();
        }
      } catch {
        // Offline-first: a failed sync leaves whatever was already cached exactly as it was.
      }
    })();

    return () => {
      cancelled = true;
    };
    // `load` intentionally excluded from deps beyond mount: it closes over `id`, which cannot
    // change for a mounted route with this dynamic segment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const goBack = () => router.replace('/library');

  const onToggleFavourite = async () => {
    const db = dbRef.current;
    if (!db || !exercise) return;
    const next = !exercise.isFavourite;

    await setLocalFavourite(db, exercise.id, next);
    setExercise({ ...exercise, isFavourite: next });

    try {
      await setExerciseFavourite(exercise.id, next);
    } catch (cause) {
      await setLocalFavourite(db, exercise.id, !next);
      setExercise({ ...exercise, isFavourite: !next });
      toast.show(
        classifyRequestFailure(cause) === 'offline'
          ? OFFLINE_MESSAGE
          : 'Could not update favourite. Please try again.',
      );
    }
  };

  const onConfirmDelete = async () => {
    if (!exercise) return;
    try {
      await deleteExercise(exercise.id);
      const db = dbRef.current;
      if (db) {
        await removeCachedExercise(db, exercise.id);
      }
      router.replace({ pathname: '/library', params: { toast: 'Exercise deleted' } });
    } catch (cause) {
      setShowDeleteSheet(false);
      toast.show(
        classifyRequestFailure(cause) === 'offline'
          ? OFFLINE_MESSAGE
          : 'Could not delete exercise. Please try again.',
      );
    }
  };

  if (!exercise) {
    return (
      <ScreenBackground>
        <Header title="Exercise" onBack={goBack} />
        {loaded && (
          <View className="flex-1 items-center justify-center px-screen-x">
            <Text className="font-archivo text-[13px] text-dimmer">
              This exercise could not be found.
            </Text>
          </View>
        )}
        <TabBar active="train" />
      </ScreenBackground>
    );
  }

  const isRunning = exercise.category === 'running';
  const showEditControls = exercise.isCustom && !isRunning;

  const tagLabels = [
    ...exercise.primaryMuscles.map((muscle) => MUSCLE_GROUP_DISPLAY_NAMES[muscle]),
    EXERCISE_GOAL_DISPLAY_NAMES[exercise.goal],
    ...(isRunning ? ['Running'] : []),
  ];
  const equipmentLabels = exercise.equipment.map((item) => EQUIPMENT_DISPLAY_NAMES[item]);

  return (
    <ScreenBackground>
      <Header
        title={exercise.name}
        onBack={goBack}
        right={
          <View className="flex-row items-center" style={{ gap: 4 }}>
            {showEditControls && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit exercise"
                  onPress={() => router.push(`/new-exercise?id=${exercise.id}`)}
                  className="-m-[5px] rounded-[10px] p-[5px]"
                  style={({ pressed }) => (pressed ? { backgroundColor: colors.iconButtonPressedBg } : null)}>
                  <Icon name="pencil" size={20} color={colors.metadata} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete exercise"
                  onPress={() => setShowDeleteSheet(true)}
                  className="-m-[5px] rounded-[10px] p-[5px]"
                  style={({ pressed }) => (pressed ? { backgroundColor: colors.destructivePressedBg } : null)}>
                  <Icon name="x" size={20} color={colors.destructive} />
                </Pressable>
              </>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={exercise.isFavourite ? 'Remove favourite' : 'Add favourite'}
              onPress={onToggleFavourite}
              className="-m-[5px] rounded-[10px] p-[5px]"
              style={({ pressed }) => (pressed ? { backgroundColor: colors.iconButtonPressedBg } : null)}>
              <Icon
                name="star"
                size={22}
                filled={exercise.isFavourite}
                color={exercise.isFavourite ? colors.accent : colors.metadata}
              />
            </Pressable>
          </View>
        }
      />

      <ScrollView className="flex-1 px-screen-x" contentContainerStyle={{ paddingBottom: 26 }}>
        <View className="flex-row flex-wrap" style={{ gap: 7, marginBottom: 14 }}>
          {tagLabels.map((label, index) => (
            <View
              key={`${label}-${index}`}
              className="rounded-[7px] border border-border bg-tagBg px-[11px] py-[6px]">
              <Text className="font-archivo text-[11.5px] font-medium text-dim">{label}</Text>
            </View>
          ))}
        </View>

        {!isRunning && equipmentLabels.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <Text
              className="font-archivo text-[9.5px] font-semibold uppercase text-legal"
              style={{ letterSpacing: 1.14, marginBottom: 8 }}>
              Equipment
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 6 }}>
              {equipmentLabels.map((label, index) => (
                <View
                  key={`${label}-${index}`}
                  className="flex-row items-center rounded-[7px] border border-equipmentPillBorder bg-pickRowSelectedBg px-[11px] py-[6px]"
                  style={{ gap: 6 }}>
                  <Icon name="dumb" size={13} color={colors.accent} />
                  <Text className="font-archivo text-[11.5px] font-semibold text-accent">{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!isRunning && exercise.instructions.length > 0 && (
          <View style={{ marginTop: 22 }}>
            <Text
              className="font-archivo text-[9.5px] font-semibold uppercase text-label"
              style={{ letterSpacing: 1.33, marginBottom: 8 }}>
              Instructions
            </Text>
            <View style={{ gap: 10 }}>
              {exercise.instructions.map((line, index) => (
                <View key={index} className="flex-row" style={{ gap: 8 }}>
                  <Text className="font-archivo text-[12.5px] font-semibold text-accent" style={{ width: 18 }}>
                    {index + 1}.
                  </Text>
                  <Text className="flex-1 font-archivo text-[13px] text-textSecondary" style={{ lineHeight: 19 }}>
                    {line}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {showDeleteSheet && (
        <View
          className="absolute inset-0 z-20 items-end justify-end"
          style={{ backgroundColor: colors.scrim }}>
          <View
            className="w-full rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]"
            style={{ gap: 14 }}>
            <Text className="font-archivo text-[18px] font-bold text-text" style={{ lineHeight: 21.6 }}>
              Delete exercise?
            </Text>
            {/* Reworded from the prototype's "permanently removed. This can't be undone." --
                Phase 2 soft-deletes so Phase 3 session history keeps its foreign key, so that
                copy would be false. See phase2-screen-specs.md §8. */}
            <Text className="font-archivo text-[13px] text-dimmer" style={{ lineHeight: 19.5 }}>
              “{exercise.name}” will be removed from the library.
            </Text>
            <View className="flex-row" style={{ gap: 9, marginTop: 6 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowDeleteSheet(false)}
                className="h-[52px] flex-1 items-center justify-center rounded-button border border-border"
                style={({ pressed }) => (pressed ? { backgroundColor: colors.borderFaint } : null)}>
                <Text className="font-archivo text-[14px] font-bold text-text">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onConfirmDelete}
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-destructive">
                <Text className="font-archivo text-[14px] font-bold text-white">Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      <TabBar active="train" />
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
