import type {
  Activity,
  ExerciseGoal,
  ExerciseMeasure,
  WorkoutEventType,
  WorkoutSessionStatus,
} from '@forjd/domain';

/**
 * The pure core of the live workout screen (Phase 3H, slice H1).
 *
 * **No React, no SQLite, no network.** Every action here takes the current session and returns
 * the next one alongside the events a caller should append to the Phase F log
 * (`store/workout-session.ts`). Three things follow from that shape, and they are the reason
 * for it:
 *
 * 1. **CLAUDE.md rule 6 becomes structural.** The live session is the one flow where the
 *    network must never be in the critical path. A module that imports nothing from
 *    `@/auth/apiClient` cannot regress that by accident, however the screen above it changes.
 * 2. **The behaviour is testable in milliseconds** -- the guards, the auto-rest, the counters
 *    and the event payloads are all exercised without rendering anything or opening a database.
 *    `live.tsx` is left as a renderer over this.
 * 3. **The log stays the source of truth.** Actions do not write; they *describe* what should
 *    be written. The caller persists first and then adopts the returned session, so a state
 *    that was never logged cannot survive on screen -- which is what makes `replaySessionState`
 *    a real recovery path rather than a decoration.
 *
 * Behaviour is ported from the prototype's `tapSet` (`FORJD Mobile.dc.html` ~line 1041),
 * including its two refusal messages verbatim, and matched against `screenshots/live
 * workout.png` and `live workout 2.png`.
 */

/** The design's own default, shown as `1:30` in the rest-timer card. */
export const DEFAULT_REST_SECONDS = 90;

export interface LiveSet {
  /** Position within the exercise. Dense and zero-based, matching `WorkoutSet.setIndex`. */
  setIndex: number;
  isCompleted: boolean;
  /** Always kilograms (ADR-016). The screen converts for display; this never holds pounds. */
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  /** Always metres. */
  distanceMeters: number | null;
}

export interface LiveExercise {
  exerciseId: string;
  /** Resolved from the on-device catalogue (ADR-022), never from a network response. */
  name: string;
  measure: ExerciseMeasure;
  /**
   * Drives the design's goal chip (`STRENGTH ▾`) and which row of the "How to train this"
   * guide is badged. Derived server-side from `measure` and carried on the catalogue row, so
   * it is read here rather than chosen -- `createExerciseRequestSchema` has no `goal` field at
   * all, and a client must not invent one.
   */
  goal: ExerciseGoal | null;
  sets: LiveSet[];
}

export interface LiveSession {
  id: string;
  templateId: string | null;
  name: string;
  activity: Activity;
  startedAt: Date;
  status: WorkoutSessionStatus;
  /** Applies to every set in this workout -- the design's own wording on the rest card. */
  restSeconds: number;
  exercises: LiveExercise[];
}

/**
 * An event a caller should append to the log. Deliberately not `SessionEventRecord`: that type
 * carries the SQLite rowid, which only exists after the insert this describes.
 */
export interface PendingEvent {
  type: WorkoutEventType;
  /** ISO-8601. Passed in rather than read from the clock, so every action is deterministic. */
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface LiveSessionChange {
  session: LiveSession;
  events: PendingEvent[];
  /** Non-null when the action began a rest period, which is what routes to the rest screen. */
  restStartedSeconds: number | null;
  /** Set when a timed set was tapped: the screen opens the set timer instead of ticking it. */
  opensTimerFor: { exerciseIndex: number; setIndex: number; seconds: number } | null;
  /** A message for the toast when the action was refused. `null` when it went through. */
  refusal: string | null;
}

export interface SessionStats {
  completedSetCount: number;
  totalSetCount: number;
  /** Kilograms, summed as weight x reps over completed weight sets only. */
  volumeKg: number;
  /** 0..1. Zero for a session with no sets, rather than NaN. */
  progress: number;
}

interface StartSessionInput {
  id: string;
  templateId: string | null;
  name: string;
  activity: Activity;
  startedAt: Date;
  exercises: {
    exerciseId: string;
    name: string;
    measure: ExerciseMeasure;
    goal?: ExerciseGoal | null;
    sets: {
      weightKg?: number | null;
      reps?: number | null;
      durationSeconds?: number | null;
      distanceMeters?: number | null;
    }[];
  }[];
}

/** The no-op result, so every action can return the same shape whatever it decided to do. */
function unchanged(session: LiveSession, refusal: string | null = null): LiveSessionChange {
  return { session, events: [], restStartedSeconds: null, opensTimerFor: null, refusal };
}

export function startSession(input: StartSessionInput): LiveSession {
  return {
    id: input.id,
    templateId: input.templateId,
    name: input.name,
    activity: input.activity,
    startedAt: input.startedAt,
    status: 'in_progress',
    restSeconds: DEFAULT_REST_SECONDS,
    exercises: input.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      measure: exercise.measure,
      goal: exercise.goal ?? null,
      // Every prescribed set is laid out up front and unticked: the user ticks them off, so an
      // unfinished session carries incomplete rows rather than missing ones (`WorkoutSet`'s own
      // docblock). Analytics later filters on `isCompleted` rather than assuming each happened.
      sets: exercise.sets.map((set, setIndex) => ({
        setIndex,
        isCompleted: false,
        weightKg: set.weightKg ?? null,
        reps: set.reps ?? null,
        durationSeconds: set.durationSeconds ?? null,
        distanceMeters: set.distanceMeters ?? null,
      })),
    })),
  };
}

export function sessionStats(session: LiveSession): SessionStats {
  let completedSetCount = 0;
  let totalSetCount = 0;
  let volumeKg = 0;

  for (const exercise of session.exercises) {
    for (const set of exercise.sets) {
      totalSetCount += 1;
      if (!set.isCompleted) continue;
      completedSetCount += 1;
      // Volume is a kilogram figure, so a timed plank or a rowed 500 m contributes nothing --
      // adding them would make the header's "1,280 kg" a number with no unit.
      if (set.weightKg !== null && set.reps !== null) {
        volumeKg += set.weightKg * set.reps;
      }
    }
  }

  return {
    completedSetCount,
    totalSetCount,
    volumeKg,
    progress: totalSetCount === 0 ? 0 : completedSetCount / totalSetCount,
  };
}

function mapExercise(
  session: LiveSession,
  exerciseIndex: number,
  map: (exercise: LiveExercise) => LiveExercise,
): LiveSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise, index) => (index === exerciseIndex ? map(exercise) : exercise)),
  };
}

/** Re-indexes after an insert or removal so `setIndex` stays dense and zero-based. */
function reindex(sets: LiveSet[]): LiveSet[] {
  return sets.map((set, setIndex) => ({ ...set, setIndex }));
}

/**
 * Ticks or unticks a set -- the screen's primary action, and the only one that starts a rest.
 *
 * The two refusals are the prototype's own, message text included. They exist because the set
 * order is the training order: ticking set 3 before set 2 would record a session the user did
 * not perform, and unticking set 2 while set 3 stands would leave a hole in the middle of it.
 */
export function completeSet(
  session: LiveSession,
  exerciseIndex: number,
  setIndex: number,
  now: Date,
): LiveSessionChange {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise) return unchanged(session);
  const set = exercise.sets[setIndex];
  if (!set) return unchanged(session);

  if (!set.isCompleted && setIndex > 0 && !exercise.sets[setIndex - 1].isCompleted) {
    return unchanged(session, `Complete set ${setIndex} first`);
  }
  if (set.isCompleted && exercise.sets.slice(setIndex + 1).some((later) => later.isCompleted)) {
    return unchanged(session, 'Untick later sets first');
  }

  // A timed set is not ticked by tapping: it is *performed* on the set-timer screen, which ticks
  // it when the countdown reaches zero. Tapping only opens that screen.
  if (!set.isCompleted && exercise.measure === 'time') {
    return {
      ...unchanged(session),
      opensTimerFor: {
        exerciseIndex,
        setIndex,
        seconds: set.durationSeconds ?? 45,
      },
    };
  }

  const occurredAt = now.toISOString();
  const nextSession = mapExercise(session, exerciseIndex, (current) => ({
    ...current,
    sets: current.sets.map((each, index) => (index === setIndex ? { ...each, isCompleted: !each.isCompleted } : each)),
  }));

  if (set.isCompleted) {
    // Unticking is a correction of a mis-tap, not a finished effort, so it starts no rest. It
    // still needs its own event: the log is append-only, so the earlier `set_completed` cannot
    // be withdrawn, and without this a crash would replay the set back into existence.
    return {
      ...unchanged(nextSession),
      events: [{ type: 'set_uncompleted', occurredAt, payload: { exerciseId: exercise.exerciseId, setIndex } }],
    };
  }

  const events: PendingEvent[] = [
    {
      type: 'set_completed',
      occurredAt,
      // The values *performed*, captured at tick time -- not the template's prescription. That
      // difference is the entire reason template and session are separate tables.
      payload: {
        exerciseId: exercise.exerciseId,
        setIndex,
        ...(set.weightKg !== null ? { weightKg: set.weightKg } : {}),
        ...(set.reps !== null ? { reps: set.reps } : {}),
        ...(set.durationSeconds !== null ? { durationSeconds: set.durationSeconds } : {}),
        ...(set.distanceMeters !== null ? { distanceMeters: set.distanceMeters } : {}),
      },
    },
  ];

  if (nextSession.exercises[exerciseIndex].sets.every((each) => each.isCompleted)) {
    events.push({ type: 'exercise_completed', occurredAt, payload: { exerciseId: exercise.exerciseId } });
  }

  events.push({ type: 'rest_started', occurredAt, payload: { seconds: session.restSeconds } });

  return {
    ...unchanged(nextSession),
    events,
    restStartedSeconds: session.restSeconds,
  };
}

/**
 * Ticks a timed set that the set-timer screen has just finished.
 *
 * Separate from `completeSet` because that one *refuses* to tick a time-measured set -- tapping
 * such a row opens the timer instead. This is the path back from that timer, and it is the only
 * other way a set can be completed, so the two together are still the whole surface.
 */
export function completeTimedSet(
  session: LiveSession,
  exerciseIndex: number,
  setIndex: number,
  now: Date,
): LiveSessionChange {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise) return unchanged(session);
  const set = exercise.sets[setIndex];
  if (!set || set.isCompleted) return unchanged(session);

  const occurredAt = now.toISOString();
  const nextSession = mapExercise(session, exerciseIndex, (current) => ({
    ...current,
    sets: current.sets.map((each, index) => (index === setIndex ? { ...each, isCompleted: true } : each)),
  }));

  const events: PendingEvent[] = [
    {
      type: 'set_completed',
      occurredAt,
      payload: {
        exerciseId: exercise.exerciseId,
        setIndex,
        ...(set.durationSeconds !== null ? { durationSeconds: set.durationSeconds } : {}),
      },
    },
  ];

  if (nextSession.exercises[exerciseIndex].sets.every((each) => each.isCompleted)) {
    events.push({ type: 'exercise_completed', occurredAt, payload: { exerciseId: exercise.exerciseId } });
  }
  events.push({ type: 'rest_started', occurredAt, payload: { seconds: session.restSeconds } });

  return { ...unchanged(nextSession), events, restStartedSeconds: session.restSeconds };
}

/**
 * The first set still to be done, which is what the rest screen's "Up next" block names. Returns
 * `null` once everything is ticked -- the rest screen then reads "All sets complete", the
 * prototype's own wording.
 */
export function nextOpenSet(session: LiveSession): { name: string; detail: string } | null {
  for (const exercise of session.exercises) {
    const set = exercise.sets.find((each) => !each.isCompleted);
    if (!set) continue;
    const detail =
      exercise.measure === 'time'
        ? `${set.durationSeconds ?? 0} s hold`
        : exercise.measure === 'distance'
          ? `${set.distanceMeters ?? 0} m`
          : `${set.weightKg ?? 0} kg × ${set.reps ?? 0} reps`;
    return { name: exercise.name, detail };
  }
  return null;
}

/**
 * Rebuilds a session from its snapshot plus the replayed state of its event log -- the crash
 * recovery path the append-only log exists for (`workout-engine.md`: "the app can be killed
 * mid-session and the state rebuilt by replay").
 *
 * The two halves are complementary and neither is sufficient alone. The snapshot says what the
 * session *is* (its name, exercises and prescribed targets); the replay says what *happened* to
 * it (which sets were ticked, whether it is paused). `completedSetKeys` is keyed
 * `exerciseId:setIndex`, which is why `setIndex` is dense and stable.
 *
 * A set that was ticked and later unticked does not appear in `completedSetKeys` at all -- the
 * replay applies `set_uncompleted` by removing the key -- so it correctly comes back open.
 */
export function restoreSession(
  snapshot: LiveSession,
  replayed: { status: WorkoutSessionStatus; completedSetKeys: string[] },
): LiveSession {
  const completed = new Set(replayed.completedSetKeys);
  return {
    ...snapshot,
    // A finished session is never restored into the live screen -- if the log says it completed,
    // it belongs to the sync queue, not to another workout.
    status: replayed.status === 'completed' ? 'completed' : replayed.status,
    exercises: snapshot.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({
        ...set,
        isCompleted: completed.has(`${exercise.exerciseId}:${set.setIndex}`),
      })),
    })),
  };
}

export function pauseSession(session: LiveSession, now: Date): LiveSessionChange {
  if (session.status !== 'in_progress') return unchanged(session);
  return {
    ...unchanged({ ...session, status: 'paused' }),
    events: [{ type: 'workout_paused', occurredAt: now.toISOString(), payload: {} }],
  };
}

export function resumeSession(session: LiveSession, now: Date): LiveSessionChange {
  if (session.status !== 'paused') return unchanged(session);
  return {
    ...unchanged({ ...session, status: 'in_progress' }),
    events: [{ type: 'workout_resumed', occurredAt: now.toISOString(), payload: {} }],
  };
}

/**
 * Ends the session. Guarded against a second emit because `workout_finished` is what enqueues
 * the session for upload (`appendSessionEvent`'s own docblock) -- emitting it twice would reset
 * a queue row's retry state behind an upload already in flight.
 */
export function finishSession(session: LiveSession, now: Date): LiveSessionChange {
  if (session.status === 'completed') return unchanged(session);
  return {
    ...unchanged({ ...session, status: 'completed' }),
    events: [{ type: 'workout_finished', occurredAt: now.toISOString(), payload: {} }],
  };
}

/**
 * Edits a set's target values. Returns a session rather than a change: nothing is logged until
 * the set is ticked, and the tick's payload carries whatever the values are by then. Logging
 * every keystroke would fill the log with states the user never performed.
 */
export function updateSet(
  session: LiveSession,
  exerciseIndex: number,
  setIndex: number,
  patch: Partial<Omit<LiveSet, 'setIndex' | 'isCompleted'>>,
): LiveSession {
  return mapExercise(session, exerciseIndex, (exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set, index) => (index === setIndex ? { ...set, ...patch } : set)),
  }));
}

/** Appends a set copying the last one's targets -- the prototype's own `addSet` behaviour. */
export function addSet(session: LiveSession, exerciseIndex: number): LiveSession {
  return mapExercise(session, exerciseIndex, (exercise) => {
    const last = exercise.sets[exercise.sets.length - 1];
    const next: LiveSet = {
      setIndex: exercise.sets.length,
      isCompleted: false,
      weightKg: last?.weightKg ?? null,
      reps: last?.reps ?? null,
      durationSeconds: last?.durationSeconds ?? null,
      distanceMeters: last?.distanceMeters ?? null,
    };
    return { ...exercise, sets: [...exercise.sets, next] };
  });
}

/** Removes a set, never the last one -- an exercise with no sets has nothing to log. */
export function removeSet(session: LiveSession, exerciseIndex: number, setIndex: number): LiveSession {
  return mapExercise(session, exerciseIndex, (exercise) => {
    if (exercise.sets.length <= 1) return exercise;
    return { ...exercise, sets: reindex(exercise.sets.filter((_, index) => index !== setIndex)) };
  });
}

/**
 * Drops an exercise from **this session only**. The template is untouched -- the prototype says
 * so in its own toast ("removed from this session only"), and it is the right default: a user
 * skipping a lift today is not editing their programme.
 */
export function removeExercise(session: LiveSession, exerciseIndex: number): LiveSession {
  return { ...session, exercises: session.exercises.filter((_, index) => index !== exerciseIndex) };
}

/** Adds an exercise mid-session, from the library's `pick=live` mode. */
export function addExercise(session: LiveSession, exercise: LiveExercise): LiveSession {
  return { ...session, exercises: [...session.exercises, exercise] };
}

/** The rest card's stepper. Floored at zero; a negative rest is not a thing. */
export function setRestSeconds(session: LiveSession, seconds: number): LiveSession {
  return { ...session, restSeconds: Math.max(0, seconds) };
}

/**
 * The design's `Set as time` control, which distance exercises alone carry: a rower can be
 * logged as 500 m or as a two-minute piece, and the athlete decides which on the day.
 *
 * It changes the exercise's own `measure` rather than adding a separate display flag, so
 * everything downstream stays consistent by construction -- which inputs the row renders,
 * whether tapping opens the set timer, and which fields the `set_completed` payload carries all
 * read that one value. A parallel "display mode" would have to be threaded through each of
 * those separately, and the first place it was forgotten would log a duration into a distance
 * field.
 */
export function setExerciseMeasure(
  session: LiveSession,
  exerciseIndex: number,
  measure: ExerciseMeasure,
): LiveSession {
  return mapExercise(session, exerciseIndex, (exercise) => ({ ...exercise, measure }));
}
