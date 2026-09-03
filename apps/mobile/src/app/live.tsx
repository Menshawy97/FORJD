import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { EXERCISE_GOAL_DISPLAY_NAMES, type ExerciseGoal } from '@forjd/domain';

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
  setExerciseMeasure,
  setRestSeconds,
  startSession,
  toUploadRequest,
  updateSet,
  type LiveSession,
  type LiveSessionChange,
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
const GOAL_GUIDE: { goal: ExerciseGoal; load: string; reps: string; rest: string; execution: string; advice: string }[] = [
  {
    goal: 'strength',
    load: '80–95% 1RM',
    reps: '1–5 reps',
    rest: '3–5 min rest',
    execution: 'Controlled down, aggressive press',
    advice: 'Move heavy weight with excellent technique',
  },
  {
    goal: 'hypertrophy',
    load: '60–80% 1RM',
    reps: '6–15 reps',
    rest: '1.5–3 min rest',
    execution: 'Controlled eccentric, full range of motion',
    advice: 'Maximise muscle tension and train close to failure',
  },
  {
    goal: 'power',
    load: '30–70% 1RM',
    reps: '2–5 reps',
    rest: '2–4 min rest',
    execution: 'Explosive concentric, reset every rep',
    advice: 'Move the bar as fast as possible',
  },
  {
    goal: 'muscular_endurance',
    load: '40–60% 1RM',
    reps: '12–25+ reps',
    rest: '30–90 s rest',
    execution: 'Controlled, steady tempo',
    advice: 'Hold form while fatigue accumulates',
  },
  {
    goal: 'mobility',
    load: 'Bodyweight',
    reps: '5–10 per side',
    rest: 'Minimal rest',
    execution: 'Slow, breathe through the position',
    advice: 'Own the end range instead of bouncing into it',
  },
];

export default function LiveScreen() {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
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
        const db = await dbRef.current;
        if (!db) return;
        await saveSessionSnapshot(db, started.id, started as unknown as Record<string, unknown>, started.startedAt.toISOString());
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


  return (
    <ScreenBackground>
      {/*
        The fixed header block. Prototype: `padding:'0 22px 14px'` -- and note the Watch card
        lives HERE, inside the non-scrolling header, not in the list below it.
      */}
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
          {/* `font:'700 28px/1 Archivo', letterSpacing:'-.02em'` */}
          <Text className="font-archivo text-[28px] font-bold tracking-[-.02em] text-text">
            {formatElapsed(elapsedSeconds)}
          </Text>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel workout"
              onPress={() => router.back()}
              className="h-[44px] w-[44px] items-center justify-center rounded-[12px]"
              style={{ backgroundColor: 'rgba(255,255,255,.06)' }}>
              <Icon name="x" size={15} color="#C9503C" />
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
            {/* Deliberately 34px tall, not 44 -- the prototype's own asymmetry. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Finish workout"
              onPress={() => {
                const endedAt = new Date();
                const change = finishSession(session, endedAt);
                apply(change);

                const finished = change.session;
                const summary = sessionStats(finished);
                void (async () => {
                  const db = await dbRef.current;
                  if (!db) return;
                  // Hand the session to the sync queue. This is the one place it happens --
                  // `appendSessionEvent` does NOT enqueue on `workout_finished`, despite what
                  // the store's module docblock used to claim.
                  await enqueueSessionUpload(db, toUploadRequest(finished, endedAt, elapsedSeconds));
                  // The snapshot exists only to recover an *unfinished* session; leaving it
                  // would offer this workout back on the next launch.
                  await clearSessionSnapshot(db, finished.id);
                })();

                setCompletedSummary({
                  name: finished.name,
                  durationSeconds: elapsedSeconds,
                  volumeKg: summary.volumeKg,
                  completedSetCount: summary.completedSetCount,
                  exerciseIds: finished.exercises.map((exercise) => exercise.exerciseId),
                  origin: 'live',
                });
                router.replace('/workout-done');
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
          <Text className="font-archivo text-[11px] font-semibold" style={{ color: '#9A9A92' }}>
            {`${stats.completedSetCount}/${stats.totalSetCount} sets`}
          </Text>
          <Text className="font-archivo text-[11px] font-semibold" style={{ color: '#6E6E66' }}>
            {`${stats.volumeKg.toLocaleString()} kg`}
          </Text>
        </View>

        {/*
          Watch card. Container matched exactly (`#141517`, radius 11, `10px 13px`, gap 9), but
          it ships an HONEST EMPTY STATE where the prototype shows `145 bpm / 142 avg`: those
          numbers are simulated (`Math.sin(elapsed/9)`) and no `HealthProvider` feeds this
          screen yet. Phase J established that invented numbers shown as a user's own training
          data are not acceptable, so the layout renders with a "not connected" line instead.
        */}
        <View
          className="mt-[12px] flex-row items-center rounded-[11px] px-[13px] py-[10px]"
          style={{ backgroundColor: '#141517', borderWidth: 1, borderColor: colors.border, gap: 9 }}>
          <View className="h-[8px] w-[8px] rounded-[5px]" style={{ backgroundColor: '#6E6E66' }} />
          <Text
            className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.12em]"
            style={{ color: '#77776F' }}>
            Watch
          </Text>
          <View className="flex-1" />
          <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#6E6E66' }}>
            No watch connected
          </Text>
        </View>

        {isLogging ? null : (
          <Text className="mt-[8px] font-archivo text-[11px] font-semibold" style={{ color: colors.errorText }}>
            Not saving — this session may be lost if the app closes
          </Text>
        )}

        {/* Says plainly that nothing was lost, rather than leaving the athlete to work it out. */}
        {resumed ? (
          <Text className="mt-[8px] font-archivo text-[11px] font-semibold" style={{ color: colors.green }}>
            Session resumed — your logged sets were recovered
          </Text>
        ) : null}
      </View>

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
        {/* "How to train this" -- `margin-bottom:14px`, radius 14, `#17181a`. */}
        <View
          className="mb-[14px] overflow-hidden rounded-[14px]"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={guideOpen ? 'Hide how to train this' : 'How to train this'}
            onPress={() => setGuideOpen((open) => !open)}
            className="flex-row items-center px-[15px] py-[13px]"
            style={{ gap: 11 }}>
            <View
              className="h-[30px] w-[30px] items-center justify-center rounded-[9px]"
              style={{ backgroundColor: 'rgba(233,113,47,.13)' }}>
              <Icon name="target" size={17} color={colors.accent} />
            </View>
            <View className="flex-1">
              <Text className="font-archivo text-[13px] font-semibold text-text">How to train this</Text>
              <Text className="mt-[4px] font-archivo text-[11px]" style={{ color: '#6E6E66' }}>
                {guideSubtitle}
              </Text>
            </View>
            <Icon name="chevron" size={16} color="#8B8B83" />
          </Pressable>

          {guideOpen ? (
            <View className="px-[15px] pb-[15px]">
              {GOAL_GUIDE.map((row) => {
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
                    <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                      <View className="flex-row items-center" style={{ gap: 7 }}>
                        <Text
                          className="font-archivo text-[12.5px] font-bold"
                          style={{ color: isCurrent ? colors.accent : '#C8C8C0' }}>
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
                      <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#8B8B83' }}>
                        {row.load}
                      </Text>
                    </View>
                    <View className="mt-[9px] flex-row" style={{ gap: 6 }}>
                      {[row.reps, row.rest].map((pill) => (
                        <View
                          key={pill}
                          className="rounded-[7px] px-[9px] py-[5px]"
                          style={{ backgroundColor: '#1B1C1E' }}>
                          <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#A9A9A1' }}>
                            {pill}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <Text className="mt-[8px] font-archivo text-[11px]" style={{ color: '#8B8B83' }}>
                      {row.execution}
                    </Text>
                    <Text className="mt-[5px] font-archivo text-[11.5px] font-semibold" style={{ color: '#E4E2DE' }}>
                      {row.advice}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>

        {/* Rest timer card -- radius 14, `12px 15px`, gap 11, 30px tile. */}
        <View
          className="mb-[14px] flex-row items-center rounded-[14px] px-[15px] py-[12px]"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 11 }}>
          <View
            className="h-[30px] w-[30px] items-center justify-center rounded-[9px]"
            style={{ backgroundColor: 'rgba(255,255,255,.05)' }}>
            <Icon name="clock" size={16} color="#8B8B83" />
          </View>
          <View className="flex-1">
            <Text className="font-archivo text-[13px] font-semibold text-text">Rest timer</Text>
            <Text className="mt-[4px] font-archivo text-[11px]" style={{ color: '#6E6E66' }}>
              Applies to every set in this workout
            </Text>
          </View>
          <View
            className="flex-row items-center rounded-[9px] p-[2px]"
            style={{ backgroundColor: '#101011', borderWidth: 1, borderColor: colors.border, gap: 2 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease rest"
              onPress={() => setSession(setRestSeconds(session, session.restSeconds - 15))}
              className="h-[26px] w-[28px] items-center justify-center rounded-[7px]">
              <Text className="font-archivo text-[15px] font-bold" style={{ color: '#9A9A92' }}>
                −
              </Text>
            </Pressable>
            <Text className="min-w-[46px] text-center font-archivo text-[13px] font-bold text-text">
              {formatRest(session.restSeconds)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase rest"
              onPress={() => setSession(setRestSeconds(session, session.restSeconds + 15))}
              className="h-[26px] w-[28px] items-center justify-center rounded-[7px]">
              <Text className="font-archivo text-[15px] font-bold" style={{ color: '#9A9A92' }}>
                +
              </Text>
            </Pressable>
          </View>
        </View>

        {session.exercises.map((exercise, exerciseIndex) => (
          <View
            key={`${exercise.exerciseId}-${exerciseIndex}`}
            className="mb-[14px] rounded-[14px] px-[16px] py-[15px]"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <View className="flex-row items-start justify-between" style={{ gap: 10 }}>
              <View className="flex-1">
                <Text className="font-archivo text-[15.5px] font-bold text-text">{exercise.name}</Text>
                <View className="mt-[7px] flex-row flex-wrap items-center" style={{ gap: 7 }}>
                  {/*
                    The goal chip. Read-only here: `goal` is derived server-side from `measure`
                    and carried on the catalogue row, never chosen by a client. The prototype's
                    per-session goal PICKER is a further step, deliberately not in this slice --
                    the chevron is drawn because the design has it.
                  */}
                  {exercise.goal ? (
                    <View
                      className="flex-row items-center rounded-[5px] px-[7px] py-[3px]"
                      style={{ backgroundColor: 'rgba(233,113,47,.13)', gap: 5 }}>
                      <Text className="font-archivo text-[8.5px] font-bold uppercase tracking-[.1em] text-accent">
                        {EXERCISE_GOAL_DISPLAY_NAMES[exercise.goal]}
                      </Text>
                      <Icon name="chevron" size={9} color={colors.accent} />
                    </View>
                  ) : null}
                  <Text className="font-archivo text-[11.5px]" style={{ color: '#6E6E66' }}>
                    {`${MEASURE_SUBTITLE[exercise.measure] ?? 'Weight'} · ${exercise.sets.length} sets`}
                  </Text>
                </View>
              </View>

              <View className="flex-row items-center" style={{ gap: 4 }}>
                {exercise.measure === 'distance' || exercise.sets.some((set) => set.distanceMeters !== null) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      exercise.measure === 'distance'
                        ? `Set ${exercise.name} as time`
                        : `Set ${exercise.name} as distance`
                    }
                    onPress={() =>
                      setSession(
                        setExerciseMeasure(
                          session,
                          exerciseIndex,
                          exercise.measure === 'distance' ? 'time' : 'distance',
                        ),
                      )
                    }
                    className="rounded-[8px] px-[9px] py-[5px]"
                    style={{
                      backgroundColor: 'rgba(233,113,47,.1)',
                      borderWidth: 1,
                      borderColor: 'rgba(233,113,47,.28)',
                    }}>
                    <Text className="font-archivo text-[10px] font-bold tracking-[.04em] text-accent">
                      {exercise.measure === 'distance' ? 'Set as time' : 'Set as distance'}
                    </Text>
                  </Pressable>
                ) : null}
                {exercise.measure === 'time' ? null : (
                  <View
                    className="rounded-[8px] px-[9px] py-[5px]"
                    style={{ backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: colors.border }}>
                    <Text
                      className="font-archivo text-[10px] font-bold uppercase tracking-[.06em]"
                      style={{ color: '#9A9A92' }}>
                      {exercise.measure === 'distance' ? 'M' : 'KG'}
                    </Text>
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${exercise.name} history`}
                  onPress={() => router.push(`/exercise/${exercise.exerciseId}`)}
                  className="p-[4px]"
                  style={{ opacity: 0.55 }}>
                  <Icon name="bars" size={18} color="#C8C8C0" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${exercise.name}`}
                  onPress={() => setSession(removeExercise(session, exerciseIndex))}
                  className="p-[4px]"
                  style={{ opacity: 0.45 }}>
                  <Icon name="x" size={15} color="#C9503C" />
                </Pressable>
              </View>
            </View>

            {/* Column headers: `padding:'0 11px 6px'`, widths 16 / 66 / flex / 44. */}
            <View className="mt-[12px] flex-row items-center px-[11px] pb-[6px]" style={{ gap: 8 }}>
              <Text
                className="w-[16px] text-center font-archivo text-[8.5px] font-semibold uppercase tracking-[.1em]"
                style={{ color: '#4D4D47' }}>
                Set
              </Text>
              <Text
                className="w-[66px] text-center font-archivo text-[8.5px] font-semibold uppercase tracking-[.1em]"
                style={{ color: '#4D4D47' }}>
                Prev
              </Text>
              <Text
                className="flex-1 text-center font-archivo text-[8.5px] font-semibold uppercase tracking-[.1em]"
                style={{ color: '#4D4D47' }}>
                Target
              </Text>
              <View className="w-[44px]" />
            </View>

            <View style={{ gap: 7 }}>
              {exercise.sets.map((set, setIndex) => {
                const numberColor = set.isCompleted ? colors.green : colors.text;
                return (
                  <View
                    key={setIndex}
                    className="flex-row items-center rounded-[10px] px-[11px] py-[10px]"
                    style={{
                      backgroundColor: set.isCompleted ? 'rgba(121,185,138,.09)' : '#141517',
                      borderWidth: 1,
                      borderColor: set.isCompleted ? 'rgba(121,185,138,.25)' : colors.border,
                      gap: 8,
                    }}>
                    <Text
                      className="w-[16px] text-center font-archivo text-[11.5px] font-semibold"
                      style={{ color: '#5C5C55' }}>
                      {setIndex + 1}
                    </Text>
                    {/*
                      PREV stays blank until local history exists -- same principle as the Watch
                      card. A first-ever session has nothing to compare against, and inventing a
                      previous performance would be inventing the athlete's own past.
                    */}
                    <Text
                      numberOfLines={1}
                      className="w-[66px] text-center font-archivo text-[10.5px] font-medium"
                      style={{ color: '#5C5C55' }}>
                      —
                    </Text>

                    <View
                      className="flex-1 flex-row items-center justify-center"
                      style={{ gap: exercise.measure === 'time' ? 4 : 6 }}>
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
                            className="w-[30px] py-[1px] text-center font-archivo text-[14px] font-semibold"
                            style={{ color: numberColor }}
                          />
                          <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#6E6E66' }}>
                            kg
                          </Text>
                          <Text className="font-archivo text-[11px]" style={{ color: '#6E6E66' }}>
                            ×
                          </Text>
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
                            className="w-[30px] py-[1px] text-center font-archivo text-[14px] font-semibold"
                            style={{ color: numberColor }}
                          />
                        </>
                      ) : exercise.measure === 'time' ? (
                        <>
                          {/* The design logs a timed set as mm:ss, not one seconds field. */}
                          <TextInput
                            accessibilityLabel={`Minutes for set ${setIndex + 1} of ${exercise.name}`}
                            value={String(Math.floor((set.durationSeconds ?? 0) / 60))}
                            keyboardType="number-pad"
                            onChangeText={(raw) =>
                              setSession(
                                updateSet(session, exerciseIndex, setIndex, {
                                  durationSeconds:
                                    (parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0) * 60 +
                                    ((set.durationSeconds ?? 0) % 60),
                                }),
                              )
                            }
                            className="w-[26px] py-[1px] text-right font-archivo text-[14px] font-semibold"
                            style={{ color: numberColor }}
                          />
                          <Text className="font-archivo text-[14px] font-bold" style={{ color: '#6E6E66' }}>
                            :
                          </Text>
                          <TextInput
                            accessibilityLabel={`Seconds for set ${setIndex + 1} of ${exercise.name}`}
                            value={String((set.durationSeconds ?? 0) % 60)}
                            keyboardType="number-pad"
                            onChangeText={(raw) =>
                              setSession(
                                updateSet(session, exerciseIndex, setIndex, {
                                  durationSeconds:
                                    Math.floor((set.durationSeconds ?? 0) / 60) * 60 +
                                    (parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0),
                                }),
                              )
                            }
                            className="w-[30px] py-[1px] text-center font-archivo text-[14px] font-semibold"
                            style={{ color: numberColor }}
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Start timer for set ${setIndex + 1} of ${exercise.name}`}
                            onPress={() => apply(completeSet(session, exerciseIndex, setIndex, new Date()))}
                            className="ml-[2px] flex-row items-center rounded-[8px] px-[9px] py-[5px]"
                            style={{ backgroundColor: 'rgba(233,113,47,.14)', gap: 5 }}>
                            <Icon name="chevron" size={10} color={colors.accent} />
                            <Text className="font-archivo text-[10.5px] font-bold text-accent">Timer</Text>
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
                            className="w-[44px] py-[1px] text-center font-archivo text-[14px] font-semibold"
                            style={{ color: numberColor }}
                          />
                          <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#6E6E66' }}>
                            m
                          </Text>
                        </>
                      )}
                    </View>

                    {exercise.sets.length > 1 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove set ${setIndex + 1} of ${exercise.name}`}
                        onPress={() => setSession(removeSet(session, exerciseIndex, setIndex))}
                        hitSlop={6}
                        style={{ opacity: 0.4 }}>
                        <Icon name="x" size={14} color="#C9503C" />
                      </Pressable>
                    ) : null}

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        set.isCompleted
                          ? `Untick set ${setIndex + 1} of ${exercise.name}`
                          : `Complete set ${setIndex + 1} of ${exercise.name}`
                      }
                      onPress={() => apply(completeSet(session, exerciseIndex, setIndex, new Date()))}
                      className="h-[24px] w-[24px] items-center justify-center rounded-[12px]"
                      style={
                        set.isCompleted
                          ? { backgroundColor: colors.green }
                          : { borderWidth: 1.5, borderColor: '#37383C' }
                      }>
                      {set.isCompleted ? <Icon name="check" size={13} color="#101011" /> : null}
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add set to ${exercise.name}`}
              onPress={() => setSession(addSet(session, exerciseIndex))}
              className="mt-[9px] h-[36px] flex-row items-center justify-center rounded-[9px]"
              style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.13)', gap: 7 }}>
              <Icon name="plus" size={15} color={colors.accent} />
              <Text className="font-archivo text-[12px] font-semibold" style={{ color: '#9A9A92' }}>
                Add set
              </Text>
            </Pressable>
          </View>
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

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
