import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { EXERCISE_GOAL_DISPLAY_NAMES, type ExerciseGoal } from '@forjd/domain';

import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { appendSessionEvent, ensureWorkoutSessionSchema, openWorkoutSessionDb } from '@/store/workout-session';
import {
  consumeCompletedTimedSet,
  consumePendingLiveSession,
  setRestContext,
  setTimerContext,
} from '@/workouts/live-handoff';
import {
  addSet,
  completeSet,
  completeTimedSet,
  finishSession,
  nextOpenSet,
  pauseSession,
  removeExercise,
  removeSet,
  resumeSession,
  sessionStats,
  setExerciseMeasure,
  setRestSeconds,
  startSession,
  updateSet,
  type LiveSession,
  type LiveSessionChange,
  type LiveSet,
  type PendingEvent,
} from '@/workouts/live-session';
import { colors } from '@/theme/tokens';

/**
 * The live workout screen (Phase 3H, slice H2), built against `screenshots/live workout.png`
 * and `live workout 2.png`.
 *
 * **There is no `s_live()` in the prototype** -- `live` is one of nine template-rendered
 * screens (see `renderVals()`'s `TMPL` array), so the authoritative prototype source is the
 * `<sc-if value="{{ isLive }}">` markup and the view-model that feeds it, not a screen
 * function. `docs/product/phase-3h-plan.md` records that correction in full.
 *
 * **All the behaviour lives in `@/workouts/live-session`**, a pure module with no React, no
 * SQLite and no network. This file renders it and persists the events it produces, in that
 * order: append to the log first, then adopt the returned session, so a state that was never
 * logged cannot survive on screen. That ordering is what makes crash recovery real.
 *
 * **No network call appears anywhere in this file** -- CLAUDE.md rule 6. Exercise names arrive
 * already resolved from the on-device catalogue (ADR-022) via the handoff, and the session is
 * handed to the sync queue only when it finishes, which is Phase I's job.
 */

/** `0:04`, `12:30`, `1:02:11` -- the prototype's own `fmt`. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** The rest card reads `1:30`, never `90` -- it is a duration, not a count. */
function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const MEASURE_SUBTITLE: Record<string, string> = {
  weight: 'Weight',
  time: 'Time',
  distance: 'Distance',
};

/**
 * The "How to train this" guide, ported verbatim from the prototype's `guideTable()`. Static
 * reference content, not advice generated about this user -- which is why it can ship now,
 * unlike the Watch card's heart rate.
 */
const GOAL_GUIDE: { goal: ExerciseGoal; load: string; reps: string; rest: string; execution: string }[] = [
  {
    goal: 'strength',
    load: '80–95% 1RM',
    reps: '1–5 reps',
    rest: '3–5 min rest',
    execution: 'Controlled down, aggressive press',
  },
  {
    goal: 'hypertrophy',
    load: '60–80% 1RM',
    reps: '6–15 reps',
    rest: '1.5–3 min rest',
    execution: 'Controlled eccentric, full range of motion',
  },
  {
    goal: 'power',
    load: '30–70% 1RM',
    reps: '2–5 reps',
    rest: '2–4 min rest',
    execution: 'Explosive concentric, reset every rep',
  },
  {
    goal: 'muscular_endurance',
    load: '40–60% 1RM',
    reps: '12–25+ reps',
    rest: '30–90 s rest',
    execution: 'Controlled, steady tempo',
  },
  {
    goal: 'mobility',
    load: 'Bodyweight',
    reps: '5–10 per side',
    rest: 'Minimal rest',
    execution: 'Slow, breathe through the position',
  },
];

/** `80 kg × 8`, `45 s`, `500 m` -- how a set reads once it is in the past. */
function describeSet(set: LiveSet, measure: string): string {
  if (measure === 'time') return `${set.durationSeconds ?? 0} s`;
  if (measure === 'distance') return `${set.distanceMeters ?? 0} m`;
  return `${set.weightKg ?? 0} kg × ${set.reps ?? 0}`;
}

export default function LiveScreen() {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const toast = useToast();
  /** Total milliseconds spent paused, so the elapsed clock can exclude them. */
  const pausedMsRef = useRef(0);
  /** False once a log write has failed -- surfaced in the header so it is not a silent loss. */
  const [isLogging, setIsLogging] = useState(true);
  /**
   * The log handle, held as a **promise** rather than a resolved value.
   *
   * Opening SQLite is asynchronous, and actions can happen before it finishes -- returning from
   * the set timer fires on the very first focus, which is well before the handle lands. A plain
   * `useRef<Db | null>` meant `persist` saw `null` and dropped those events on the floor: the
   * set showed as ticked but nothing reached the log, so a crash would have lost it. Awaiting a
   * promise instead makes every write queue behind the open rather than race it.
   */
  const dbRef = useRef<Promise<Awaited<ReturnType<typeof openWorkoutSessionDb>> | null> | null>(null);

  useEffect(() => {
    const pending = consumePendingLiveSession();
    if (!pending) {
      // Nothing to run. Reached only by opening /live directly, which the app itself never
      // does -- both entry points set the handoff first.
      return;
    }
    setSession(
      startSession({
        id: pending.id,
        templateId: pending.templateId,
        name: pending.name,
        activity: pending.activity,
        startedAt: new Date(),
        exercises: pending.exercises,
      }),
    );
  }, []);

  // Started during the first render rather than in an effect, so the promise exists before any
  // focus effect can fire an action against it.
  if (dbRef.current === null) {
    dbRef.current = (async () => {
      try {
        const db = await openWorkoutSessionDb();
        await ensureWorkoutSessionSchema(db);
        return db;
      } catch {
        // A session must still be runnable when the local store cannot be opened -- losing
        // crash recovery is bad, but blocking the workout on it would be worse. `persist`
        // resolves to null and simply writes nothing.
        return null;
      }
    })();
  }

  /**
   * The elapsed clock. Stops while paused, matching the prototype's own interval guard.
   *
   * Two details that both had to be got right:
   *
   * - **It depends on `session?.status`, not on `session`.** The session object is a new
   *   reference after every reducer call, including one per keystroke in a weight field. With
   *   the object as the dependency, the interval was torn down and rebuilt faster than it could
   *   fire, so the header clock visibly froze while the athlete typed a weight.
   * - **It is wall-clock based**, like the rest and set-timer countdowns: a counter incremented
   *   once a second under-reports badly across a backgrounded app, and a workout is exactly the
   *   situation where the phone spends long stretches locked in a pocket.
   */
  const startedAtMs = session?.startedAt.getTime() ?? null;
  const sessionStatus = session?.status ?? null;
  useEffect(() => {
    if (startedAtMs === null || sessionStatus !== 'in_progress') return;
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - startedAtMs - pausedMsRef.current) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAtMs, sessionStatus]);

  // Paused stretches are excluded from elapsed time, matching `WorkoutSession.durationSeconds`'s
  // own contract ("excluding paused stretches ... not simply endedAt - startedAt").
  useEffect(() => {
    if (sessionStatus !== 'paused') return;
    const pausedAt = Date.now();
    return () => {
      pausedMsRef.current += Date.now() - pausedAt;
    };
  }, [sessionStatus]);

  /**
   * Writes events to the local log.
   *
   * **A failure here is surfaced, never swallowed.** This is the one write that makes crash
   * recovery real, so a set that appears ticked while its write failed is precisely the silent
   * corruption the event log exists to prevent. The athlete is told their workout is not being
   * saved rather than finding out afterwards; the session itself keeps running, because
   * stopping a workout over a storage fault would be the worse trade.
   */
  const persist = useCallback(
    async (sessionId: string, events: PendingEvent[]) => {
      if (events.length === 0) return;
      try {
        const db = await dbRef.current;
        if (!db) {
          setIsLogging(false);
          return;
        }
        for (const event of events) {
          await appendSessionEvent(db, sessionId, event.type, event.occurredAt, event.payload);
        }
        setIsLogging(true);
      } catch {
        setIsLogging(false);
        toast.show('This workout is not being saved. Your sets still count on screen.');
      }
    },
    [toast],
  );

  /**
   * The one place a `LiveSessionChange` is applied. Events are written before the new session
   * is adopted, so the screen never shows a state the log does not already contain.
   */
  const apply = useCallback(
    (change: LiveSessionChange) => {
      if (change.refusal) {
        toast.show(change.refusal);
        return;
      }
      void persist(change.session.id, change.events);
      setSession(change.session);
      if (change.restStartedSeconds !== null) {
        const upNext = nextOpenSet(change.session);
        setRestContext({
          seconds: change.restStartedSeconds,
          upNextName: upNext?.name ?? null,
          upNextDetail: upNext?.detail ?? null,
        });
        router.push('/rest');
      }
      if (change.opensTimerFor) {
        const { exerciseIndex, setIndex, seconds } = change.opensTimerFor;
        setTimerContext({
          exerciseIndex,
          setIndex,
          exerciseName: change.session.exercises[exerciseIndex]?.name ?? 'Timed set',
          seconds,
        });
        router.push('/set-timer');
      }
    },
    [persist, toast],
  );

  /**
   * The timed-set screen's return channel. It cannot tick the set itself -- it runs on its own
   * route -- so it records which set finished and this consumes the result on focus, putting the
   * tick through the reducer. Consumed once, so bouncing back here again cannot double-tick.
   */
  useFocusEffect(
    useCallback(() => {
      const finished = consumeCompletedTimedSet();
      if (!finished) return;
      setSession((current) => {
        if (!current) return current;
        const change = completeTimedSet(current, finished.exerciseIndex, finished.setIndex, new Date());
        void persist(change.session.id, change.events);
        return change.session;
      });
    }, [persist]),
  );

  if (!session) {
    return (
      <ScreenBackground>
        <View className="flex-1 items-center justify-center px-screen-x">
          <Text className="font-archivo text-[13px] text-dimmer">No workout in progress.</Text>
        </View>
      </ScreenBackground>
    );
  }

  const stats = sessionStats(session);
  const isPaused = session.status === 'paused';
  // The guide's subtitle names the exercise being worked -- the first with an open set, which
  // is what the prototype calls the "current" lift.
  const currentExercise =
    session.exercises.find((exercise) => exercise.sets.some((set) => !set.isCompleted)) ??
    session.exercises[session.exercises.length - 1];
  const currentGoal = currentExercise?.goal ?? null;
  const guideSubtitle = currentExercise
    ? `${currentExercise.name}${currentGoal ? ` · ${EXERCISE_GOAL_DISPLAY_NAMES[currentGoal]}` : ''}`
    : 'Load, reps and rest by goal';

  return (
    <ScreenBackground>
      <View className="flex-none px-screen-x pb-[14px]">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View className="h-[7px] w-[7px] rounded-[4px]" style={{ backgroundColor: colors.accent }} />
          <Text
            numberOfLines={1}
            className="flex-1 font-archivo text-[10px] font-semibold uppercase tracking-[.14em] text-accent">
            {`${isPaused ? 'Paused' : 'Live'} · ${session.name}`}
          </Text>
        </View>

        <View className="mt-[10px] flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text className="font-archivo text-[28px] font-bold text-text">{formatElapsed(elapsedSeconds)}</Text>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel workout"
              onPress={() => router.back()}
              className="h-[44px] w-[44px] items-center justify-center rounded-[12px]"
              style={{ backgroundColor: 'rgba(255,255,255,.06)' }}>
              <Icon name="x" size={15} color={colors.errorText} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isPaused ? 'Resume workout' : 'Pause workout'}
              onPress={() => {
                const now = new Date();
                apply(isPaused ? resumeSession(session, now) : pauseSession(session, now));
              }}
              className="h-[44px] items-center justify-center rounded-[12px] px-[14px]"
              style={{ backgroundColor: 'rgba(255,255,255,.06)' }}>
              <Text className="font-archivo text-[12px] font-bold text-text">{isPaused ? 'Resume' : 'Pause'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Finish workout"
              // Routed through `apply` like every other action, rather than repeating its
              // persist-then-adopt logic here -- otherwise anything later added to `apply`
              // would silently not happen when a workout is finished.
              onPress={() => {
                apply(finishSession(session, new Date()));
                router.back();
              }}
              className="h-[34px] items-center justify-center rounded-[10px] px-[14px]"
              style={{ backgroundColor: colors.accent }}>
              <Text className="font-archivo text-[12px] font-bold text-white">Finish</Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-[14px] flex-row items-center" style={{ gap: 10 }}>
          <View className="h-[3px] flex-1 overflow-hidden rounded-[2px]" style={{ backgroundColor: '#232427' }}>
            <View
              accessibilityLabel="Workout progress"
              className="h-[3px]"
              style={{ width: `${stats.progress * 100}%`, backgroundColor: colors.accent }}
            />
          </View>
          <Text className="font-archivo text-[11px] font-semibold text-dim">
            {`${stats.completedSetCount}/${stats.totalSetCount} sets`}
          </Text>
          <Text className="font-archivo text-[11px] font-semibold text-dimmer">
            {`${stats.volumeKg.toLocaleString()} kg`}
          </Text>
        </View>

        {isLogging ? null : (
          <Text className="mt-[8px] font-archivo text-[11px] font-semibold" style={{ color: colors.errorText }}>
            Not saving — this session may be lost if the app closes
          </Text>
        )}
      </View>

      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        {/*
          The design's Watch card. It ships an HONEST EMPTY STATE: the prototype simulates heart
          rate with `Math.sin(elapsed/9)`, and no `HealthProvider` feeds this screen yet. Phase J
          already established that showing invented numbers as a user's own training data is not
          acceptable, so the layout renders with a "not connected" line rather than fake bpm.
        */}
        <View
          className="flex-row items-center rounded-[11px] px-[13px] py-[10px]"
          style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border, gap: 9 }}>
          <View className="h-[8px] w-[8px] rounded-[5px]" style={{ backgroundColor: colors.dimmer }} />
          <Text className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.12em] text-label">Watch</Text>
          <View className="flex-1" />
          <Text className="font-archivo text-[11.5px] text-dimmer">No watch connected</Text>
        </View>

        {/* "How to train this" -- the design's collapsible guide, between Watch and Rest. */}
        <View
          className="mt-[12px] rounded-card px-[15px] py-[14px]"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={guideOpen ? 'Hide how to train this' : 'How to train this'}
            onPress={() => setGuideOpen((open) => !open)}
            className="flex-row items-center"
            style={{ gap: 12 }}>
            <View
              className="h-[34px] w-[34px] items-center justify-center rounded-[11px]"
              style={{ backgroundColor: colors.accentTileBg }}>
              <Icon name="target" size={17} color={colors.accent} />
            </View>
            <View className="flex-1">
              <Text className="font-archivo text-[13.5px] font-bold text-text">How to train this</Text>
              <Text className="mt-[3px] font-archivo text-[11.5px] text-dimmer">{guideSubtitle}</Text>
            </View>
            <Icon name="chevron" size={15} color={colors.dimmer} />
          </Pressable>

          {guideOpen
            ? GOAL_GUIDE.map((row) => {
                const isCurrent = row.goal === currentGoal;
                return (
                  <View
                    key={row.goal}
                    className="mt-[13px] pt-[13px]"
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: 'rgba(255,255,255,.06)',
                      opacity: isCurrent ? 1 : 0.66,
                    }}>
                    <View className="flex-row items-center" style={{ gap: 8 }}>
                      <Text
                        className="font-archivo text-[12.5px] font-bold"
                        style={{ color: isCurrent ? colors.accent : colors.dim }}>
                        {EXERCISE_GOAL_DISPLAY_NAMES[row.goal]}
                      </Text>
                      {isCurrent ? (
                        <View
                          className="rounded-[5px] px-[7px] py-[3px]"
                          style={{ backgroundColor: 'rgba(233,113,47,.16)' }}>
                          <Text className="font-archivo text-[8.5px] font-bold uppercase tracking-[.1em] text-accent">
                            This lift
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className="mt-[6px] font-archivo text-[11.5px] text-dim">
                      {`${row.load} · ${row.reps} · ${row.rest}`}
                    </Text>
                    <Text className="mt-[4px] font-archivo text-[11.5px] text-dimmer">{row.execution}</Text>
                  </View>
                );
              })
            : null}
        </View>

        <View
          className="mt-[12px] flex-row items-center rounded-[11px] px-[13px] py-[10px]"
          style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border, gap: 11 }}>
          <Icon name="clock" size={16} color={colors.dim} />
          <View className="flex-1">
            <Text className="font-archivo text-[13px] font-bold text-text">Rest timer</Text>
            <Text className="mt-[2px] font-archivo text-[11px] text-dimmer">Applies to every set in this workout</Text>
          </View>
          <View
            className="flex-row items-center rounded-[9px] px-[10px] py-[7px]"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease rest"
              onPress={() => setSession(setRestSeconds(session, session.restSeconds - 15))}>
              <Text className="font-archivo text-[14px] font-bold text-dim">−</Text>
            </Pressable>
            <Text className="font-archivo text-[13px] font-bold text-text">{formatRest(session.restSeconds)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase rest"
              onPress={() => setSession(setRestSeconds(session, session.restSeconds + 15))}>
              <Text className="font-archivo text-[14px] font-bold text-dim">+</Text>
            </Pressable>
          </View>
        </View>

        {session.exercises.map((exercise, exerciseIndex) => (
          <View
            key={`${exercise.exerciseId}-${exerciseIndex}`}
            className="mt-[12px] rounded-card px-[15px] pb-[15px] pt-[13px]"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text className="flex-1 font-archivo text-[16px] font-bold text-text">{exercise.name}</Text>
              {/*
                `Set as time` -- distance exercises only, exactly as `live workout 2.png` shows
                on Row Machine. A rower is logged as 500 m or as a timed piece, athlete's call.
              */}
              {exercise.measure === 'distance' || exercise.sets.some((set) => set.distanceMeters !== null) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    exercise.measure === 'distance' ? `Set ${exercise.name} as time` : `Set ${exercise.name} as distance`
                  }
                  onPress={() =>
                    setSession(
                      setExerciseMeasure(session, exerciseIndex, exercise.measure === 'distance' ? 'time' : 'distance'),
                    )
                  }
                  className="rounded-[7px] px-[9px] py-[5px]"
                  style={{ backgroundColor: 'rgba(233,113,47,.14)' }}>
                  <Text className="font-archivo text-[10.5px] font-bold text-accent">
                    {exercise.measure === 'distance' ? 'Set as time' : 'Set as distance'}
                  </Text>
                </Pressable>
              ) : null}
              <View
                className="rounded-[6px] px-[8px] py-[4px]"
                style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border }}>
                <Text className="font-archivo text-[9.5px] font-bold uppercase tracking-[.06em] text-dim">
                  {exercise.measure === 'distance' ? 'M' : 'KG'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${exercise.name} history`}
                onPress={() => router.push(`/exercise/${exercise.exerciseId}`)}
                hitSlop={8}>
                <Icon name="bars" size={15} color={colors.dim} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${exercise.name}`}
                onPress={() => setSession(removeExercise(session, exerciseIndex))}
                hitSlop={8}>
                <Icon name="x" size={15} color={colors.dimmer} />
              </Pressable>
            </View>

            {/*
              The goal chip. Read-only here: `goal` is derived server-side from `measure` and
              carried on the catalogue row, never chosen by a client. The prototype's per-session
              goal *picker* is a further step, deliberately not built in this slice.
            */}
            <View className="mt-[8px] flex-row items-center" style={{ gap: 8 }}>
              {exercise.goal ? (
                <View
                  className="rounded-[6px] px-[8px] py-[4px]"
                  style={{ backgroundColor: 'rgba(233,113,47,.12)', borderWidth: 1, borderColor: 'rgba(233,113,47,.28)' }}>
                  <Text className="font-archivo text-[9.5px] font-bold uppercase tracking-[.06em] text-accent">
                    {EXERCISE_GOAL_DISPLAY_NAMES[exercise.goal]}
                  </Text>
                </View>
              ) : null}
              <Text className="font-archivo text-[11.5px] text-dimmer">
                {`${MEASURE_SUBTITLE[exercise.measure] ?? 'Weight'} · ${exercise.sets.length} sets`}
              </Text>
            </View>

            <View className="mt-[11px] flex-row" style={{ gap: 10 }}>
              <Text className="w-[28px] font-archivo text-[9px] font-semibold uppercase tracking-[.1em] text-label">
                Set
              </Text>
              <Text className="w-[62px] font-archivo text-[9px] font-semibold uppercase tracking-[.1em] text-label">
                Prev
              </Text>
              <Text className="font-archivo text-[9px] font-semibold uppercase tracking-[.1em] text-label">Target</Text>
            </View>

            {exercise.sets.map((set, setIndex) => (
              <View
                key={setIndex}
                className="mt-[8px] flex-row items-center rounded-[10px] px-[10px] py-[9px]"
                style={{
                  backgroundColor: set.isCompleted ? 'rgba(121,185,138,.10)' : colors.fieldBg,
                  borderWidth: 1,
                  borderColor: set.isCompleted ? 'rgba(121,185,138,.28)' : colors.border,
                  gap: 10,
                }}>
                <Text className="w-[18px] font-archivo text-[12px] font-semibold text-dim">{setIndex + 1}</Text>
                {/*
                  PREV is blank until local history exists. Same principle as the Watch card --
                  a first-ever session has nothing to compare against, and inventing a previous
                  performance would be inventing the user's own past.
                */}
                <Text className="w-[62px] font-archivo text-[10.5px] text-dimmer">—</Text>

                <View className="flex-1 flex-row items-center" style={{ gap: 6 }}>
                  {exercise.measure === 'weight' ? (
                    <>
                      <TextInput
                        accessibilityLabel={`Weight for set ${setIndex + 1} of ${exercise.name}`}
                        value={set.weightKg === null ? '' : String(set.weightKg)}
                        keyboardType="decimal-pad"
                        onChangeText={(raw) =>
                          setSession(
                            updateSet(session, exerciseIndex, setIndex, {
                              weightKg: raw === '' ? null : Number(raw.replace(/[^0-9.]/g, '')) || 0,
                            }),
                          )
                        }
                        className="w-[46px] font-archivo text-[14px] font-bold text-text"
                      />
                      <Text className="font-archivo text-[10.5px] text-dimmer">kg ×</Text>
                      <TextInput
                        accessibilityLabel={`Reps for set ${setIndex + 1} of ${exercise.name}`}
                        value={set.reps === null ? '' : String(set.reps)}
                        keyboardType="number-pad"
                        onChangeText={(raw) =>
                          setSession(
                            updateSet(session, exerciseIndex, setIndex, {
                              reps: raw === '' ? null : parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0,
                            }),
                          )
                        }
                        className="w-[34px] font-archivo text-[14px] font-bold text-text"
                      />
                    </>
                  ) : exercise.measure === 'time' ? (
                    <>
                      <Text className="font-archivo text-[14px] font-bold text-text">
                        {describeSet(set, exercise.measure)}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Start timer for set ${setIndex + 1} of ${exercise.name}`}
                        onPress={() => apply(completeSet(session, exerciseIndex, setIndex, new Date()))}
                        className="flex-row items-center rounded-[7px] px-[9px] py-[5px]"
                        style={{ backgroundColor: 'rgba(233,113,47,.14)', gap: 5 }}>
                        <Text className="font-archivo text-[11px] font-bold text-accent">▶ Timer</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <TextInput
                        accessibilityLabel={`Distance for set ${setIndex + 1} of ${exercise.name}`}
                        value={set.distanceMeters === null ? '' : String(set.distanceMeters)}
                        keyboardType="number-pad"
                        onChangeText={(raw) =>
                          setSession(
                            updateSet(session, exerciseIndex, setIndex, {
                              distanceMeters: raw === '' ? null : Number(raw.replace(/[^0-9.]/g, '')) || 0,
                            }),
                          )
                        }
                        className="w-[54px] font-archivo text-[14px] font-bold text-text"
                      />
                      <Text className="font-archivo text-[10.5px] text-dimmer">m</Text>
                    </>
                  )}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove set ${setIndex + 1} of ${exercise.name}`}
                  onPress={() => setSession(removeSet(session, exerciseIndex, setIndex))}
                  hitSlop={6}>
                  <Icon name="x" size={13} color={colors.errorText} />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    set.isCompleted
                      ? `Untick set ${setIndex + 1} of ${exercise.name}`
                      : `Complete set ${setIndex + 1} of ${exercise.name}`
                  }
                  onPress={() => apply(completeSet(session, exerciseIndex, setIndex, new Date()))}
                  className="h-[26px] w-[26px] items-center justify-center rounded-[13px]"
                  style={
                    set.isCompleted ? { backgroundColor: colors.green } : { borderWidth: 1.5, borderColor: '#37383C' }
                  }>
                  {set.isCompleted ? <Icon name="check" size={13} color="#101011" /> : null}
                </Pressable>
              </View>
            ))}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add set to ${exercise.name}`}
              onPress={() => setSession(addSet(session, exerciseIndex))}
              className="mt-[12px] h-[40px] flex-row items-center justify-center rounded-[10px]"
              style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, gap: 7 }}>
              <Icon name="plus" size={14} color={colors.dim} />
              <Text className="font-archivo text-[12.5px] font-semibold text-dim">Add set</Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add exercise"
          onPress={() => router.push('/library?pick=live')}
          className="mt-[14px] h-[52px] flex-row items-center justify-center rounded-[12px]"
          style={{
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: 'rgba(233,113,47,.45)',
            backgroundColor: 'rgba(233,113,47,.06)',
            gap: 8,
          }}>
          <Icon name="plus" size={16} color={colors.accent} />
          <Text className="font-archivo text-[13.5px] font-bold text-accent">Add exercise</Text>
        </Pressable>

        <View style={{ height: 28 }} />
      </ScrollView>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
