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
import { activeWorkout } from '@/workouts/active-workout';
import { toLiveExercise } from '@/workouts/start-session';
import { formatElapsed } from '@/workouts/format-elapsed';
import { useActiveWorkout } from '@/workouts/use-active-workout';
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
  resumeSession,
  sessionStats,
  setAllExerciseGoals,
  setExerciseGoal,
  setExerciseMeasure,
  setRestSeconds,
  toUploadRequest,
  updateSet,
  type LiveSessionChange,
} from '@/workouts/live-session';
import { workoutNotice } from '@/workouts/workout-notice';
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

export { formatElapsed };

export default function LiveScreen() {
  /**
   * The workout is not this screen's: it lives in `activeWorkout`, which outlives it (12B-2b). Pressing back
   * leaves the screen and the workout carries on, shown by the bar above the tab bar and the lock-screen
   * notice, and opening it again lands back here with everything where it was.
   */
  const workout = useActiveWorkout();
  const session = workout.session;
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
      if (cancelled) return;
      setUnitByExercise(stored);
      // The lock-screen notice and the bar read loads in the same units. Only once they are known: telling them
      // an empty map first would flip every exercise back to kg for a moment.
      workoutNotice.setUnits(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toast = useToast();

  // Whether this screen is open decides when the lock-screen card is taken down (three hours away).
  useFocusEffect(
    useCallback(() => {
      workoutNotice.setViewing(true);
      return () => workoutNotice.setViewing(false);
    }, []),
  );

  /**
   * Start a handed-over workout, or **pick one back up** that the app closed on.
   *
   * The resume path is what makes the append-only log more than bookkeeping: the snapshot says what the
   * session is, the replayed log says what happened to it, and together they rebuild it exactly as the
   * athlete left it. A workout already running is shown as it is: starting a second one would throw the
   * first away, so the request is declined with a message instead.
   */
  const hasStarted = useRef(false);
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    const pending = consumePendingLiveSession();
    if (pending) {
      if (activeWorkout.isActive()) {
        toast.show('Finish or discard your current workout first.');
        return;
      }
      activeWorkout.start(pending);
      return;
    }
    void activeWorkout.restore();
  }, [toast]);

  /**
   * The elapsed clock. Stops while paused, matching the prototype's own interval guard.
   *
   * - **It depends on `session?.status`, not on `session`.** The session object is a new reference after
   *   every reducer call, including one per keystroke in a weight field; with the object as the
   *   dependency the interval was torn down and rebuilt faster than it could fire, so the header clock
   *   froze while the athlete typed a weight.
   * - **It is wall-clock based**, like the rest and set-timer countdowns: a counter incremented once a
   *   second under-reports badly across a backgrounded app. The store does the sum (start, less every
   *   paused stretch), so this screen, the bar and the notice always agree.
   */
  const startedAtMs = session?.startedAt.getTime() ?? null;
  const sessionStatus = session?.status ?? null;
  useEffect(() => {
    if (startedAtMs === null) return;
    const tick = () => setElapsedSeconds(activeWorkout.elapsedSeconds(Date.now()));
    tick();
    if (sessionStatus !== 'in_progress') return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAtMs, sessionStatus]);

  /**
   * A log write that failed is surfaced, never swallowed: this is the one write that makes crash recovery
   * real, so a set that appears ticked while its write failed is precisely the silent corruption the log
   * exists to prevent. The athlete is told their workout is not being saved rather than finding out
   * afterwards; the session itself keeps running, because stopping a workout over a storage fault would
   * be the worse trade.
   */
  const seenLogFailures = useRef(workout.logFailures);
  useEffect(() => {
    if (workout.logFailures > seenLogFailures.current) {
      toast.show('This workout is not being saved. Your sets still count on screen.');
    }
    seenLogFailures.current = workout.logFailures;
  }, [workout.logFailures, toast]);

  /**
   * The one place a `LiveSessionChange` from this screen is applied: the store logs its events and adopts
   * the session, then this opens whichever screen the change calls for. The rest itself (its end time, its
   * alert, the lock-screen countdown) starts in the notice controller, which follows the store, so a rest
   * begun from the lock screen is the very same one.
   */
  const apply = useCallback(
    (change: LiveSessionChange) => {
      if (change.refusal) {
        toast.show(change.refusal);
        return;
      }
      activeWorkout.apply(change);
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
    [toast],
  );

  /**
   * The timed-set screen's return channel. It cannot tick the set itself -- it runs on its own
   * route -- so it records which set finished and this consumes the result on focus, putting the
   * tick through the reducer. Consumed once, so bouncing back here again cannot double-tick.
   */
  useFocusEffect(
    useCallback(() => {
      const finished = consumeCompletedTimedSet();
      const current = activeWorkout.getState().session;
      if (finished && current) {
        const change = completeTimedSet(current, finished.exerciseIndex, finished.setIndex, new Date());
        // As before, a finished hold logs its rest but does not open the rest screen or start the alert.
        activeWorkout.apply({ ...change, restStartedSeconds: null });
      }

      // An exercise added mid-session from `library.tsx?pick=live`. One prescribed set, since
      // the library knows nothing about how many the athlete intends -- `Add set` covers the
      // rest, and one is the smallest honest default.
      const picked = consumePickedExerciseForLive();
      if (picked) {
        activeWorkout.update((currentSession) =>
          addExercise(
            currentSession,
            toLiveExercise({
              exerciseId: picked.exerciseId,
              name: picked.name,
              measure: picked.measure,
              goal: picked.goal,
              setCount: 1,
            }),
          ),
        );
      }
    }, []),
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

    activeWorkout.update((current) =>
      goalPickAll ? setAllExerciseGoals(current, goal) : setExerciseGoal(current, goalPickIndex, goal),
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

    const nextUnits = { ...unitByExercise, [exerciseId]: next };
    setUnitByExercise(nextUnits);
    workoutNotice.setUnits(nextUnits);
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
    // From here a late start position is ignored: Finish clears the snapshot, and a position that
    // arrived afterwards must not write it back for a workout that is already in the upload queue.
    activeWorkout.markFinishing();
    const endedAt = new Date();
    const change = finishSession(session, endedAt);
    apply(change);

    const finished = change.session;
    const summary = sessionStats(finished);

    void (async () => {
      try {
        // Hand the session to the sync queue and clear the snapshot that would offer it back. The store
        // does both behind every log write, and rejects when the workout could not be queued.
        await activeWorkout.queueForUpload(toUploadRequest(finished, endedAt, elapsedSeconds));

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
        // Queued for upload: the workout is over, so the bar and the notice have nothing left to show.
        activeWorkout.clear();
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
        isLogging={workout.isLogging}
        resumed={workout.resumed}
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
          onDecrease={() => activeWorkout.update((current) => setRestSeconds(current, current.restSeconds - 15))}
          onIncrease={() => activeWorkout.update((current) => setRestSeconds(current, current.restSeconds + 15))}
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
              activeWorkout.update((current) =>
                setExerciseMeasure(current, exerciseIndex, exercise.measure === 'distance' ? 'time' : 'distance'),
              )
            }
            onToggleUnit={() => toggleUnit(exercise.exerciseId, exercise.measure)}
            onOpenHistory={() => router.push(`/exercise/${exercise.exerciseId}`)}
            onRemoveExercise={() => activeWorkout.update((current) => removeExercise(current, exerciseIndex))}
            onUpdateSet={(setIndex, patch) =>
              activeWorkout.update((current) => updateSet(current, exerciseIndex, setIndex, patch))
            }
            onCompleteSet={(setIndex) => apply(completeSet(session, exerciseIndex, setIndex, new Date()))}
            onRemoveSet={(setIndex) => activeWorkout.update((current) => removeSet(current, exerciseIndex, setIndex))}
            onAddSet={() => activeWorkout.update((current) => addSet(current, exerciseIndex))}
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
              style={{ color: '#94948B' }}>
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
                    <Text className="mt-[3px] font-archivo text-[11.5px]" style={{ color: '#94948B' }}>
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
