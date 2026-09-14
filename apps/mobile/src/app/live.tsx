import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  EXERCISE_GOAL_DISPLAY_NAMES,
  distanceForDisplay,
  nextDistanceUnit,
  nextWeightUnit,
  weightForDisplay,
  type DistanceDisplayUnit,
  type ExerciseGoal,
  type WeightDisplayUnit,
} from '@forjd/domain';

import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import {
  appendSessionEvent,
  clearSessionSnapshot,
  enqueueSessionUpload,
  ensureWorkoutSessionSchema,
  getSessionEvents,
  getUnfinishedSessionSnapshot,
  openWorkoutSessionDb,
  replaySessionState,
  saveSessionSnapshot,
} from '@/store/workout-session';
import {
  consumeCompletedTimedSet,
  consumePendingLiveSession,
  consumePickedExerciseForLive,
  setCompletedSummary,
  setRestContext,
  setTimerContext,
} from '@/workouts/live-handoff';
import {
  getExerciseUnits,
  setExerciseUnit,
  type DisplayUnit,
  type ExerciseUnitMap,
} from '@/store/exercise-unit-preferences';
import { toLiveExercise } from '@/workouts/start-session';
import {
  addExercise,
  addSet,
  completeSet,
  completeTimedSet,
  finishSession,
  nextOpenSet,
  pauseSession,
  removeExercise,
  removeSet,
  restoreSession,
  resumeSession,
  sessionStats,
  setAllExerciseGoals,
  setExerciseGoal,
  setExerciseMeasure,
  setRestSeconds,
  startSession,
  toUploadRequest,
  updateSet,
  type LiveSession,
  type LiveSessionChange,
  type PendingEvent,
} from '@/workouts/live-session';
import { GOAL_GUIDE } from '@/workouts/goal-guide';
import { LiveExerciseCard } from '@/workouts/live-exercise-card';
import { LiveSessionHeader } from '@/workouts/live-session-header';
import { RestTimerCard } from '@/workouts/rest-timer-card';
import { TrainingGuideCard } from '@/workouts/training-guide-card';
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

export default function LiveScreen() {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  /**
   * Which unit each exercise is displayed in, remembered across workouts.
   *
   * Held in state and loaded once rather than read per render: it is a display preference, so a
   * missing entry is simply the metric default, and a screen that awaited storage before drawing
   * a set row would stall the workout for a value that changes about once a year.
   */
  const [unitByExercise, setUnitByExercise] = useState<ExerciseUnitMap>({});
  /** Which exercise's goal sheet is open, by index. `null` is closed. */
  const [goalPickIndex, setGoalPickIndex] = useState<number | null>(null);
  /** The sheet's "Apply to every exercise" checkbox. Resets with the sheet. */
  const [goalPickAll, setGoalPickAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getExerciseUnits().then((stored) => {
      if (!cancelled) setUnitByExercise(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** True when this screen picked a session back up after a crash rather than starting one. */
  const [resumed, setResumed] = useState(false);
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

  /**
   * Start a handed-over session, or **resume one a crash interrupted**.
   *
   * The resume path is what makes the append-only log more than bookkeeping: the snapshot says
   * what the session is, the replayed log says what happened to it, and together they rebuild
   * the screen exactly as the athlete left it -- ticked sets, paused state and elapsed time
   * included. Without it a force-killed app silently loses the workout and orphans its events.
   */
  useEffect(() => {
    let cancelled = false;
    const pending = consumePendingLiveSession();

    if (pending) {
      const started = startSession({
        id: pending.id,
        templateId: pending.templateId,
        name: pending.name,
        activity: pending.activity,
        startedAt: new Date(),
        exercises: pending.exercises,
      });
      setSession(started);
      // Snapshot once, at start. The mutable part of a session is exactly what the event log
      // already carries, so rewriting this per tick would reintroduce the mutable
      // "current session" row the append-only design exists to avoid.
      void (async () => {
        try {
          const db = await dbRef.current;
          if (!db) return;
          await saveSessionSnapshot(db, started.id, started as unknown as Record<string, unknown>, started.startedAt.toISOString());
        } catch {
          // Crash recovery for this session is degraded, not lost: the workout itself keeps
          // running from in-memory state either way (H6) -- there is nothing for the athlete to
          // act on here, only a risk that a force-kill before the first snapshot lands would not
          // be recoverable. Rethrowing would surface an unhandled rejection for a session the
          // athlete is actively, successfully running.
        }
      })();
      return;
    }

    void (async () => {
      const db = await dbRef.current;
      if (!db || cancelled) return;
      const snapshot = await getUnfinishedSessionSnapshot(db);
      if (!snapshot || cancelled) return;

      const stored = snapshot.payload as unknown as LiveSession;
      const startedAt = new Date(snapshot.startedAt);
      const events = await getSessionEvents(db, snapshot.sessionId);
      const replayed = replaySessionState(startedAt, events);

      if (replayed.status === 'completed') {
        // Already finished; it belongs to the sync queue, not to another workout.
        await clearSessionSnapshot(db, snapshot.sessionId);
        return;
      }
      if (cancelled) return;

      setSession(restoreSession({ ...stored, startedAt }, replayed));

      /**
       * The stretch the app was closed for counts as **paused**, not as training.
       *
       * `replaySessionState` gives the working duration up to the last logged event, which is
       * the honest figure. The elapsed clock is wall-clock based (`now - startedAt - paused`),
       * so without this the minutes or hours the app spent dead would be added to the workout.
       * Seeding the paused total with the difference makes the clock read exactly the replayed
       * duration on resume and tick correctly onward from there.
       */
      pausedMsRef.current = Math.max(0, Date.now() - startedAt.getTime() - replayed.durationSeconds * 1000);
      setElapsedSeconds(replayed.durationSeconds);
      setResumed(true);
    })();

    return () => {
      cancelled = true;
    };
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
      if (finished) {
        setSession((current) => {
          if (!current) return current;
          const change = completeTimedSet(current, finished.exerciseIndex, finished.setIndex, new Date());
          void persist(change.session.id, change.events);
          return change.session;
        });
      }

      // An exercise added mid-session from `library.tsx?pick=live`. One prescribed set, since
      // the library knows nothing about how many the athlete intends -- `Add set` covers the
      // rest, and one is the smallest honest default.
      const picked = consumePickedExerciseForLive();
      if (picked) {
        setSession((current) =>
          current
            ? addExercise(
                current,
                toLiveExercise({
                  exerciseId: picked.exerciseId,
                  name: picked.name,
                  measure: picked.measure,
                  goal: picked.goal,
                  setCount: 1,
                }),
              )
            : current,
        );
      }
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

  /**
   * The unit this exercise is shown in. Metric is the default for anything never toggled, which
   * is also what an athlete who never finds the chip gets -- and what every stored value already
   * is (ADR-016).
   */
  const weightUnitFor = (exerciseId: string): WeightDisplayUnit =>
    unitByExercise[exerciseId] === 'lb' ? 'lb' : 'kg';
  const distanceUnitFor = (exerciseId: string): DistanceDisplayUnit =>
    unitByExercise[exerciseId] === 'mi' ? 'mi' : 'm';

  /**
   * Flips one exercise's unit and remembers it.
   *
   * State updates first and the write is not awaited: the chip must feel instant, and a failed
   * write costs one tap next time rather than a wrong number now. **No set is rewritten** --
   * every weight stays the kilograms it already was, and only the rendering of it changes.
   */
  /**
   * The exercise whose goal sheet is open, resolved from the index rather than held as a copy --
   * a copy would go stale the moment the goal changed, and the sheet has to show the new
   * selection immediately.
   */
  const goalPickTarget = goalPickIndex === null ? null : session.exercises[goalPickIndex] ?? null;

  /**
   * Applies the chosen goal and closes the sheet.
   *
   * The checkbox is read here rather than at the option, so ticking it after choosing is not a
   * silent no-op -- the design puts the checkbox below the options for exactly this reason, and
   * the athlete's last state of it is what the tap means.
   */
  const pickGoal = (goal: ExerciseGoal) => {
    if (goalPickIndex === null) return;
    const exercise = session.exercises[goalPickIndex];

    setSession(
      goalPickAll
        ? setAllExerciseGoals(session, goal)
        : setExerciseGoal(session, goalPickIndex, goal),
    );
    toast.show(
      goalPickAll
        ? `Every exercise set to ${EXERCISE_GOAL_DISPLAY_NAMES[goal]}`
        : `${exercise?.name ?? 'Exercise'} → ${EXERCISE_GOAL_DISPLAY_NAMES[goal]}`,
    );
    setGoalPickIndex(null);
  };

  const toggleUnit = (exerciseId: string, measure: string) => {
    const next: DisplayUnit =
      measure === 'distance'
        ? nextDistanceUnit(distanceUnitFor(exerciseId))
        : nextWeightUnit(weightUnitFor(exerciseId));

    setUnitByExercise((current) => ({ ...current, [exerciseId]: next }));
    void setExerciseUnit(exerciseId, next);
  };

  const handlePauseResume = () => {
    const now = new Date();
    apply(isPaused ? resumeSession(session, now) : pauseSession(session, now));
  };

  /**
   * Navigation used to fire unconditionally, with the enqueue running in an uncaught,
   * unawaited IIFE (H6): a rejection there was both an unhandled promise rejection and a
   * silently lost workout, because the screen had already moved on to workout-done.
   * `router.replace` now only happens once the session is durably queued; any failure -- the
   * enqueue rejecting, or `db` never having opened at all -- keeps the athlete on this screen
   * with a warning instead of discarding the workout.
   */
  const handleFinish = () => {
    const endedAt = new Date();
    const change = finishSession(session, endedAt);
    apply(change);

    const finished = change.session;
    const summary = sessionStats(finished);

    void (async () => {
      try {
        const db = await dbRef.current;
        if (!db) {
          throw new Error('Local database unavailable');
        }
        // Hand the session to the sync queue. This is the one place it happens --
        // `appendSessionEvent` does NOT enqueue on `workout_finished`, despite what
        // the store's module docblock used to claim.
        await enqueueSessionUpload(db, toUploadRequest(finished, endedAt, elapsedSeconds));
        // The snapshot exists only to recover an *unfinished* session; leaving it
        // would offer this workout back on the next launch.
        await clearSessionSnapshot(db, finished.id);

        setCompletedSummary({
          name: finished.name,
          durationSeconds: elapsedSeconds,
          volumeKg: summary.volumeKg,
          completedSetCount: summary.completedSetCount,
          exerciseIds: finished.exercises.map((exercise) => exercise.exerciseId),
          // Completed sets only, and in the unit the athlete was reading -- this is a
          // record of what they did, not of what was prescribed.
          exercises: finished.exercises
            .map((exercise) => {
              const done = exercise.sets.filter((set) => set.isCompleted);
              const first = done[0];
              const unit = weightUnitFor(exercise.exerciseId);
              const detail =
                first === undefined
                  ? ''
                  : exercise.measure === 'time'
                    ? `${first.durationSeconds ?? 0} s`
                    : exercise.measure === 'distance'
                      ? `${distanceForDisplay(first.distanceMeters ?? 0, distanceUnitFor(exercise.exerciseId))} ${distanceUnitFor(exercise.exerciseId)}`
                      : `${weightForDisplay(first.weightKg ?? 0, unit)} ${unit}`;
              return {
                exerciseId: exercise.exerciseId,
                name: exercise.name,
                setCount: done.length,
                detail,
              };
            })
            .filter((line) => line.setCount > 0),
          origin: 'live',
        });
        router.replace('/workout-done');
      } catch {
        // The most safety-critical message in the app: the session is finished in
        // memory but not yet durable anywhere else. Staying on this screen keeps the
        // in-memory state (and the athlete's option to retry Finish) alive rather
        // than navigating away from data that only exists here.
        toast.show('Workout not saved — check your connection and try Finish again.');
      }
    })();
  };

  return (
    <ScreenBackground>
      <LiveSessionHeader
        sessionName={session.name}
        isPaused={isPaused}
        elapsedLabel={formatElapsed(elapsedSeconds)}
        stats={stats}
        isLogging={isLogging}
        resumed={resumed}
        onCancel={() => router.back()}
        onPauseResume={handlePauseResume}
        onFinish={handleFinish}
      />

      {/*
        Scroll area. Prototype: `padding:'0 22px 26px'`.

        `automaticallyAdjustKeyboardInsets` is what keeps the row being edited visible. Every set
        row holds two numeric inputs, and the numeric keypad covers roughly the bottom third of the
        screen -- without this the athlete taps a weight field low in the list and the keypad lands
        directly on top of the number they are typing. iOS-only by design; on Android the window
        resizes for the keyboard already.

        `keyboardShouldPersistTaps="handled"` fixes the other half of the same problem: with the
        keypad open, the first tap on a set's tick would otherwise be swallowed dismissing the
        keyboard, so completing a set mid-workout took two taps.
      */}
      <ScrollView
        className="flex-1 px-screen-x"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled">
        <TrainingGuideCard
          guideOpen={guideOpen}
          guideSubtitle={guideSubtitle}
          currentGoal={currentGoal}
          onToggle={() => setGuideOpen((open) => !open)}
        />

        <RestTimerCard
          restSeconds={session.restSeconds}
          onDecrease={() => setSession(setRestSeconds(session, session.restSeconds - 15))}
          onIncrease={() => setSession(setRestSeconds(session, session.restSeconds + 15))}
        />

        {session.exercises.map((exercise, exerciseIndex) => (
          <LiveExerciseCard
            key={`${exercise.exerciseId}-${exerciseIndex}`}
            exercise={exercise}
            weightUnit={weightUnitFor(exercise.exerciseId)}
            distanceUnit={distanceUnitFor(exercise.exerciseId)}
            onOpenGoalPicker={() => {
              setGoalPickAll(false);
              setGoalPickIndex(exerciseIndex);
            }}
            onToggleMeasure={() =>
              setSession(
                setExerciseMeasure(
                  session,
                  exerciseIndex,
                  exercise.measure === 'distance' ? 'time' : 'distance',
                ),
              )
            }
            onToggleUnit={() => toggleUnit(exercise.exerciseId, exercise.measure)}
            onOpenHistory={() => router.push(`/exercise/${exercise.exerciseId}`)}
            onRemoveExercise={() => setSession(removeExercise(session, exerciseIndex))}
            onUpdateSet={(setIndex, patch) => setSession(updateSet(session, exerciseIndex, setIndex, patch))}
            onCompleteSet={(setIndex) => apply(completeSet(session, exerciseIndex, setIndex, new Date()))}
            onRemoveSet={(setIndex) => setSession(removeSet(session, exerciseIndex, setIndex))}
            onAddSet={() => setSession(addSet(session, exerciseIndex))}
          />
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add exercise"
          onPress={() => router.push('/library?pick=live')}
          className="h-[46px] flex-row items-center justify-center rounded-[11px]"
          style={{
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: 'rgba(233,113,47,.45)',
            backgroundColor: 'rgba(233,113,47,.06)',
            gap: 8,
          }}>
          <Icon name="plus" size={16} color={colors.accent} />
          <Text className="font-archivo text-[13px] font-bold text-accent">Add exercise</Text>
        </Pressable>

        <View style={{ height: 26 }} />
      </ScrollView>

      {/*
        The training-goal sheet. Prototype geometry: scrim `rgba(0,0,0,.62)`, panel `#17181a`
        with a `20px 20px 0 0` radius and `18px 20px 24px` padding, the eyebrow at
        `600 9.5px/1` letterspaced `.14em`, the exercise name at `700 18px/1.2`, options in a
        column with `gap:8`, and the apply-to-all row `13px 14px` on `#141517`.

        Each option carries the guide's own load and rep range, so the choice is made against
        what it actually means rather than against a bare word.
      */}
      {goalPickTarget ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close training goal"
          onPress={() => setGoalPickIndex(null)}
          className="absolute inset-0 z-30 justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,.62)' }}>
          {/* Swallows taps so pressing the panel does not dismiss it -- the prototype's stopProp. */}
          <Pressable
            onPress={() => undefined}
            className="w-full rounded-t-[20px] px-[20px] pb-[24px] pt-[18px]"
            style={{ backgroundColor: '#17181A', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.09)' }}>
            <Text
              className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
              style={{ color: '#77776F' }}>
              Training goal
            </Text>
            <Text className="mt-[9px] font-archivo text-[18px] font-bold" style={{ color: colors.text }}>
              {goalPickTarget.name}
            </Text>

            <View className="mt-[16px]" style={{ gap: 8 }}>
              {GOAL_GUIDE.map((row) => {
                const isSelected = goalPickTarget.goal === row.goal;
                return (
                  <Pressable
                    key={row.goal}
                    accessibilityRole="button"
                    accessibilityLabel={`Set goal to ${EXERCISE_GOAL_DISPLAY_NAMES[row.goal]}`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => pickGoal(row.goal)}
                    className="rounded-[11px] px-[14px] py-[13px]"
                    style={{
                      backgroundColor: isSelected ? 'rgba(233,113,47,.13)' : '#141517',
                      borderWidth: 1,
                      borderColor: isSelected ? 'rgba(233,113,47,.45)' : 'rgba(255,255,255,.07)',
                    }}>
                    <Text
                      className="font-archivo text-[13.5px] font-semibold"
                      style={{ color: isSelected ? colors.accent : colors.text }}>
                      {EXERCISE_GOAL_DISPLAY_NAMES[row.goal]}
                    </Text>
                    <Text className="mt-[3px] font-archivo text-[11.5px]" style={{ color: '#77776F' }}>
                      {`${row.load} · ${row.reps}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Apply to every exercise in this live workout"
              accessibilityState={{ checked: goalPickAll }}
              onPress={() => setGoalPickAll((on) => !on)}
              className="mt-[14px] flex-row items-center rounded-[11px] px-[14px] py-[13px]"
              style={{ backgroundColor: '#141517', borderWidth: 1, borderColor: 'rgba(255,255,255,.07)', gap: 11 }}>
              <View
                className="h-[20px] w-[20px] items-center justify-center rounded-[6px]"
                style={
                  goalPickAll
                    ? { backgroundColor: colors.accent }
                    : { borderWidth: 1.5, borderColor: '#37383C' }
                }>
                {goalPickAll ? <Icon name="check" size={12} color="#FFFFFF" /> : null}
              </View>
              <Text className="flex-1 font-archivo text-[12.5px] font-semibold" style={{ color: '#D8D8D0' }}>
                Apply to every exercise in this live workout
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      ) : null}

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
