import {
  EQUIPMENT_DISPLAY_NAMES,
  EXERCISE_CATEGORY_DISPLAY_NAMES,
  EXERCISE_GOAL_DISPLAY_NAMES,
  MUSCLE_GROUP_DISPLAY_NAMES,
} from '@forjd/domain';
import type { ExerciseHistoryResponse, ExerciseResponse } from '@forjd/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { deleteExercise, getExerciseCatalogue, getExerciseHistory, setExerciseFavourite } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { Sparkline } from '@/features/exercise/sparkline';
import { trainingTip } from '@/exercises/training-tip';
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
import { formatHistoryDate } from '@/workouts/previous-workout';
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
 * **The strength stat tiles, trend and History are real as of Phase 3J-d**, from
 * `GET /workouts/sessions/exercise/:exerciseId`. Their empty states remain and still matter:
 * they are what an exercise the athlete has never performed shows, and what a failed history
 * request falls back to. The **running** branch's tiles, route map and pace trend are still
 * empty -- they need GPS-tracked runs, which this phase does not ship. **Instructions are
 * shown** (§8's
 * deviation list) even though the prototype has no field for them, because the ingested
 * dataset provides real ones and an exercise detail with nothing but tags would be thinner
 * than the design intends.
 */
/**
 * Ports the prototype's `stat(label, value, unit, sub)` card (§4.2 item 3 / §5 item 2).
 *
 * **The empty state is still the default and still matters.** An em dash renders whenever
 * `value` is absent -- which is what an exercise never performed shows, and what "Est. 1RM"
 * shows even beside a real best set when the reps ran past the range Epley can speak to. No
 * `unit` renders without a number to qualify.
 */
function StatTile({ label, value, unit }: { label: string; value?: string; unit?: string }) {
  const shown = value ?? '—';
  return (
    <View
      className="flex-1 rounded-card border border-border bg-surface px-[14px] py-[13px]"
      style={{ minWidth: 0 }}>
      <Text
        className="font-archivo text-[9.5px] font-semibold uppercase text-label"
        style={{ letterSpacing: 1.33, marginBottom: 9 }}>
        {label}
      </Text>
      <View className="flex-row items-baseline" style={{ gap: 4 }}>
        <Text
          className="font-archivo font-bold text-text"
          numberOfLines={1}
          style={{
            letterSpacing: -0.5,
            // The prototype drops 25px to 19px past five characters, so a long value shrinks
            // rather than overflowing its card.
            fontSize: shown.length > 5 ? 19 : 25,
            fontVariant: ['tabular-nums'],
          }}>
          {shown}
        </Text>
        {value !== undefined && unit !== undefined ? (
          <Text className="font-archivo text-[11.5px] font-medium text-dimmer">{unit}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function ExerciseDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [exercise, setExercise] = useState<ExerciseResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  /**
   * `null` until the history request resolves, and after one that fails -- both render the
   * screen's shipped empty states, which are also what an exercise never performed shows. The
   * catalogue read is what this screen is *for*; its history is an enrichment, so a failure
   * here must not cost the athlete the exercise itself (Phase 3J-d).
   */
  const [history, setHistory] = useState<ExerciseHistoryResponse | null>(null);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const toast = useToast();
  const dbRef = useRef<SqliteConnection | null>(null);

  const historySessions = history?.sessions ?? [];

  /**
   * The trend's points, oldest first -- the direction a line is read. The response is newest
   * first, because that is the order the History list below wants, so this reverses it rather
   * than making the server answer twice in two orders.
   *
   * Sessions with no weight are dropped rather than plotted as zero: a bodyweight or timed set
   * is not a lighter lift, and a zero would draw the line through the floor.
   */
  const trendPoints = [...historySessions]
    .reverse()
    .map((session) => session.weightKg)
    .filter((weight): weight is number => weight !== null);

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

    // Its own effect, deliberately separate from the catalogue read below: the two are
    // independent, and neither failing should delay or cancel the other.
    (async () => {
      if (typeof id !== 'string') return;
      try {
        const loadedHistory = await getExerciseHistory(id);
        if (!cancelled) setHistory(loadedHistory);
      } catch {
        // Offline, or an exercise never performed — the shipped empty states already say so.
      }
    })();

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

  // Muscles, then category, then goal, then a Custom badge for a user-authored exercise --
  // both category and goal show (the running variant's category tag reads "Running" on its
  // own now, so the old category-only special case for it is gone) at the user's explicit
  // request: both are real, distinct classifications, and showing only one hid the other.
  const tagLabels = [
    ...exercise.primaryMuscles.map((muscle) => MUSCLE_GROUP_DISPLAY_NAMES[muscle]),
    EXERCISE_CATEGORY_DISPLAY_NAMES[exercise.category],
    EXERCISE_GOAL_DISPLAY_NAMES[exercise.goal],
    ...(exercise.isCustom ? ['Custom'] : []),
  ];
  const equipmentLabels = exercise.equipment.map((item) => EQUIPMENT_DISPLAY_NAMES[item]);
  // A custom exercise's tip is whatever the user wrote in its own Description field
  // (new-exercise.tsx's "cues, setup or form notes") -- never `trainingTip`'s generated
  // fallback, which has no way to know what a made-up exercise actually needs. No
  // description means no tip box at all, the same "real content or omit" rule the equipment
  // block and Instructions section already follow.
  const tipText = exercise.isCustom
    ? exercise.description
    : trainingTip(exercise.name, exercise.primaryMuscles);

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

        {!isRunning && tipText && (
          <View
            className="flex-row rounded-[12px] border border-trainingTipBorder bg-trainingTipBg px-[14px] py-[13px]"
            style={{ gap: 10, marginBottom: 14 }}>
            <View style={{ marginTop: 1 }}>
              <Icon name="bolt" size={16} color={colors.accent} />
            </View>
            <Text className="flex-1 font-archivo text-[12.5px] text-trainingTipText" style={{ lineHeight: 18.75 }}>
              <Text className="font-archivo text-[12.5px] font-bold text-accent">How to train it: </Text>
              <Text>{tipText}</Text>
            </Text>
          </View>
        )}

        {!isRunning && (
          <>
            <View className="flex-row" style={{ gap: 10, marginBottom: 14 }}>
              <StatTile
                label="Best set"
                value={
                  history?.bestSet
                    ? `${history.bestSet.weightKg} kg × ${history.bestSet.reps}`
                    : undefined
                }
              />
              {/*
                Independent of the tile beside it: a real best set can have no estimate, because
                Epley refuses past twelve reps. That tile then keeps its em dash rather than
                showing a number the formula cannot stand behind.
              */}
              <StatTile
                label="Est. 1RM"
                value={
                  history?.estimatedOneRepMaxKg === null || history?.estimatedOneRepMaxKg === undefined
                    ? undefined
                    : String(history.estimatedOneRepMaxKg)
                }
                unit="kg"
              />
            </View>
            <View
              className="rounded-card border border-border bg-surface px-[16px] py-[15px]"
              style={{ marginBottom: 14 }}>
              <Text
                className="font-archivo text-[9.5px] font-semibold uppercase text-label"
                style={{ letterSpacing: 1.33, marginBottom: 14 }}>
                Top set — last 8 sessions
              </Text>
              {trendPoints.length >= 2 ? (
                <Sparkline points={trendPoints} />
              ) : (
                <View className="items-center justify-center" style={{ height: 80 }}>
                  {/*
                    One session is not a trend, so a single point keeps the copy rather than
                    drawing a line through nothing.
                  */}
                  <Text className="font-archivo text-[12px] text-dimmer">
                    Log a set to see your trend.
                  </Text>
                </View>
              )}
            </View>
            <Text
              className="font-archivo text-[9.5px] font-semibold uppercase text-label"
              style={{ letterSpacing: 1.33, marginBottom: 2 }}>
              History
            </Text>
            {historySessions.length === 0 ? (
              <Text className="font-archivo text-[13px] text-dimmer" style={{ paddingVertical: 26 }}>
                No sessions logged yet.
              </Text>
            ) : (
              historySessions.map((session) => (
                <View
                  key={session.sessionId}
                  className="flex-row items-center justify-between"
                  style={{
                    paddingVertical: 13,
                    borderBottomWidth: 1,
                    borderBottomColor: 'rgba(255,255,255,.05)',
                  }}>
                  <Text className="font-archivo text-[13px] font-medium" style={{ color: '#B4B4AC' }}>
                    {formatHistoryDate(new Date(session.performedAt), new Date())}
                  </Text>
                  <Text
                    className="font-archivo text-[12.5px] font-medium text-dim"
                    style={{ fontVariant: ['tabular-nums'] }}>
                    {session.weightKg === null || session.reps === null
                      ? '—'
                      : `${session.weightKg} kg × ${session.reps}`}
                  </Text>
                </View>
              ))
            )}
          </>
        )}

        {isRunning && (
          <>
            <View className="flex-row" style={{ gap: 10 }}>
              <StatTile label="Best time" />
              <StatTile label="Avg pace" />
            </View>
            <View
              className="overflow-hidden rounded-card border border-border"
              style={{ height: 150, marginTop: 12, backgroundColor: colors.trackBg }}>
              <View className="flex-1 items-center justify-center">
                <Text className="font-archivo text-[12px] text-dimmer">No routes logged yet.</Text>
              </View>
            </View>
            <View
              className="rounded-card border border-border bg-surface px-[16px] py-[15px]"
              style={{ marginTop: 12 }}>
              <Text
                className="font-archivo text-[9.5px] font-semibold uppercase text-label"
                style={{ letterSpacing: 1.33, marginBottom: 14 }}>
                Pace trend — 8 runs
              </Text>
              <View className="items-center justify-center" style={{ height: 80 }}>
                <Text className="font-archivo text-[12px] text-dimmer">Log a run to see your trend.</Text>
              </View>
            </View>
            <Text
              className="font-archivo text-[9.5px] font-semibold uppercase text-label"
              style={{ letterSpacing: 1.33, marginTop: 24, marginBottom: 2 }}>
              Recent runs
            </Text>
            <Text className="font-archivo text-[13px] text-dimmer" style={{ paddingVertical: 26 }}>
              No runs logged yet.
            </Text>
          </>
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
