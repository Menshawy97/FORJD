// Phase 3H, slice H1 -- written before the module, per the project's test-first rule.
//
// `live-session.ts` is the pure core of the live workout screen: it holds no React state, opens
// no database and makes no request. Every action takes the current session and returns the next
// one plus the events a caller should append to the Phase F log. That split is what lets the
// whole of the live flow's *behaviour* be tested here, in milliseconds, leaving `live.tsx` as a
// thin renderer -- and it is what makes CLAUDE.md rule 6 checkable rather than aspirational,
// since a module with no imports from `@/auth/apiClient` cannot put the network in the critical
// path by accident.
//
// The guards and the auto-rest come from the prototype's own `tapSet` (FORJD Mobile.dc.html
// ~line 1041), which is the authoritative behaviour for this screen.
import {
  addSet,
  completeSet,
  finishSession,
  pauseSession,
  removeExercise,
  removeSet,
  restoreSession,
  resumeSession,
  sessionStats,
  setRestSeconds,
  startSession,
  updateSet,
  type LiveSession,
} from '../live-session';

const NOW = new Date('2026-09-02T18:00:00.000Z');
const LATER = new Date('2026-09-02T18:01:00.000Z');

function session(): LiveSession {
  return startSession({
    id: 'session-1',
    templateId: 'template-1',
    name: 'Upper / Lower',
    activity: 'strength',
    startedAt: NOW,
    exercises: [
      {
        exerciseId: 'ex-1',
        name: 'Bench Press',
        measure: 'weight',
        sets: [
          { weightKg: 80, reps: 8 },
          { weightKg: 80, reps: 8 },
        ],
      },
      {
        exerciseId: 'ex-2',
        name: 'Plank',
        measure: 'time',
        sets: [{ durationSeconds: 45 }],
      },
    ],
  });
}

describe('startSession', () => {
  it('lays out every prescribed set up front, unticked', () => {
    const live = session();

    expect(live.exercises).toHaveLength(2);
    expect(live.exercises[0].sets).toHaveLength(2);
    expect(live.exercises[0].sets.every((set) => !set.isCompleted)).toBe(true);
    // The domain's own note: an unfinished session carries incomplete rows, never missing ones.
    expect(live.exercises[1].sets[0].durationSeconds).toBe(45);
  });

  it('starts in progress with the design default rest of 90 seconds', () => {
    const live = session();

    expect(live.status).toBe('in_progress');
    expect(live.restSeconds).toBe(90);
  });
});

describe('sessionStats', () => {
  it('counts every prescribed set, not only the finished ones', () => {
    expect(sessionStats(session())).toMatchObject({ completedSetCount: 0, totalSetCount: 3 });
  });

  it('sums volume as weight x reps over completed sets only', () => {
    const live = completeSet(session(), 0, 0, NOW).session;

    expect(sessionStats(live)).toMatchObject({ completedSetCount: 1, volumeKg: 640 });
  });

  it('ignores time and distance sets in volume, which is a kilogram figure', () => {
    let live = session();
    live = completeSet(live, 0, 0, NOW).session;
    live = completeSet(live, 0, 1, NOW).session;
    live = completeSet(live, 1, 0, NOW).session;

    expect(sessionStats(live).volumeKg).toBe(1280);
  });

  it('reports progress as a fraction, and never divides by zero on an empty session', () => {
    const empty = startSession({
      id: 's',
      templateId: null,
      name: 'Empty',
      activity: 'strength',
      startedAt: NOW,
      exercises: [],
    });

    expect(sessionStats(empty).progress).toBe(0);
    expect(sessionStats(completeSet(session(), 0, 0, NOW).session).progress).toBeCloseTo(1 / 3);
  });
});

describe('completeSet', () => {
  it('marks the set done and emits set_completed carrying the id and index', () => {
    const change = completeSet(session(), 0, 0, NOW);

    expect(change.session.exercises[0].sets[0].isCompleted).toBe(true);
    expect(change.events).toContainEqual({
      type: 'set_completed',
      occurredAt: NOW.toISOString(),
      payload: { exerciseId: 'ex-1', setIndex: 0, weightKg: 80, reps: 8 },
    });
  });

  it('starts the rest timer, which is what pushes the user to the rest screen', () => {
    const change = completeSet(session(), 0, 0, NOW);

    expect(change.restStartedSeconds).toBe(90);
    expect(change.events).toContainEqual({
      type: 'rest_started',
      occurredAt: NOW.toISOString(),
      payload: { seconds: 90 },
    });
  });

  it('emits exercise_completed only when the last set of that exercise is ticked', () => {
    const first = completeSet(session(), 0, 0, NOW);
    expect(first.events.map((event) => event.type)).not.toContain('exercise_completed');

    const second = completeSet(first.session, 0, 1, LATER);
    expect(second.events).toContainEqual({
      type: 'exercise_completed',
      occurredAt: LATER.toISOString(),
      payload: { exerciseId: 'ex-1' },
    });
  });

  it('refuses to tick a set while an earlier one is still open, with the prototype copy', () => {
    const change = completeSet(session(), 0, 1, NOW);

    expect(change.refusal).toBe('Complete set 1 first');
    expect(change.events).toEqual([]);
    expect(change.session.exercises[0].sets[1].isCompleted).toBe(false);
  });

  it('refuses to untick a set while a later one is still ticked', () => {
    let live = completeSet(session(), 0, 0, NOW).session;
    live = completeSet(live, 0, 1, NOW).session;

    const change = completeSet(live, 0, 0, LATER);

    expect(change.refusal).toBe('Untick later sets first');
    expect(change.session.exercises[0].sets[0].isCompleted).toBe(true);
  });

  it('unticks with its own event, because the log is append-only', () => {
    const live = completeSet(session(), 0, 0, NOW).session;

    const change = completeSet(live, 0, 0, LATER);

    expect(change.session.exercises[0].sets[0].isCompleted).toBe(false);
    expect(change.events).toEqual([
      { type: 'set_uncompleted', occurredAt: LATER.toISOString(), payload: { exerciseId: 'ex-1', setIndex: 0 } },
    ]);
    // Unticking is a correction, not a finished effort -- it must not start a rest period.
    expect(change.restStartedSeconds).toBeNull();
  });

  it('routes a time-measured set to its timer instead of ticking it directly', () => {
    const change = completeSet(session(), 1, 0, NOW);

    expect(change.opensTimerFor).toEqual({ exerciseIndex: 1, setIndex: 0, seconds: 45 });
    expect(change.session.exercises[1].sets[0].isCompleted).toBe(false);
    expect(change.events).toEqual([]);
  });

  it('rests for the session rest length, so changing it changes the next rest', () => {
    const live = setRestSeconds(session(), 120);

    expect(completeSet(live, 0, 0, NOW).restStartedSeconds).toBe(120);
  });
});

describe('pause and resume', () => {
  it('emits workout_paused and reaches the paused status', () => {
    const change = pauseSession(session(), NOW);

    expect(change.session.status).toBe('paused');
    expect(change.events).toEqual([{ type: 'workout_paused', occurredAt: NOW.toISOString(), payload: {} }]);
  });

  it('emits workout_resumed and returns to in progress', () => {
    const paused = pauseSession(session(), NOW).session;

    const change = resumeSession(paused, LATER);

    expect(change.session.status).toBe('in_progress');
    expect(change.events).toEqual([{ type: 'workout_resumed', occurredAt: LATER.toISOString(), payload: {} }]);
  });

  it('does not emit a second pause for an already paused session', () => {
    const paused = pauseSession(session(), NOW).session;

    expect(pauseSession(paused, LATER).events).toEqual([]);
  });
});

describe('finishSession', () => {
  it('completes the session and emits workout_finished exactly once', () => {
    const change = finishSession(session(), LATER);

    expect(change.session.status).toBe('completed');
    expect(change.events).toEqual([{ type: 'workout_finished', occurredAt: LATER.toISOString(), payload: {} }]);
    expect(finishSession(change.session, LATER).events).toEqual([]);
  });
});

describe('editing the session in flight', () => {
  it('writes an edited weight onto the set without logging anything yet', () => {
    const live = updateSet(session(), 0, 0, { weightKg: 82.5 });

    expect(live.exercises[0].sets[0].weightKg).toBe(82.5);
  });

  it('carries the edited values into the set_completed payload', () => {
    const live = updateSet(session(), 0, 0, { weightKg: 82.5, reps: 6 });

    expect(completeSet(live, 0, 0, NOW).events[0]).toMatchObject({
      payload: { exerciseId: 'ex-1', setIndex: 0, weightKg: 82.5, reps: 6 },
    });
  });

  it('copies the last set when adding one, which is what the design implies', () => {
    const live = addSet(updateSet(session(), 0, 1, { weightKg: 85, reps: 5 }), 0);

    expect(live.exercises[0].sets).toHaveLength(3);
    expect(live.exercises[0].sets[2]).toMatchObject({ weightKg: 85, reps: 5, isCompleted: false });
  });

  it('removes a set and keeps the remaining set indices dense', () => {
    const live = removeSet(session(), 0, 0);

    expect(live.exercises[0].sets).toHaveLength(1);
    expect(live.exercises[0].sets[0].setIndex).toBe(0);
  });

  it('refuses to remove the only set of an exercise', () => {
    expect(removeSet(session(), 1, 0).exercises[1].sets).toHaveLength(1);
  });

  it('removes an exercise from this session only', () => {
    const live = removeExercise(session(), 0);

    expect(live.exercises.map((exercise) => exercise.exerciseId)).toEqual(['ex-2']);
  });
});

describe('immutability', () => {
  it('never mutates the session it was given', () => {
    const original = session();
    const snapshot = JSON.stringify(original);

    completeSet(original, 0, 0, NOW);
    updateSet(original, 0, 0, { weightKg: 100 });
    addSet(original, 0);
    removeExercise(original, 0);
    pauseSession(original, NOW);

    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('restoreSession', () => {
  it('rebuilds the ticked sets from a replayed log', () => {
    const restored = restoreSession(session(), {
      status: 'in_progress',
      completedSetKeys: ['ex-1:0', 'ex-2:0'],
    });

    expect(restored.exercises[0].sets[0].isCompleted).toBe(true);
    expect(restored.exercises[0].sets[1].isCompleted).toBe(false);
    expect(restored.exercises[1].sets[0].isCompleted).toBe(true);
  });

  it('keeps the prescription the snapshot carries, which the log does not', () => {
    const restored = restoreSession(session(), { status: 'in_progress', completedSetKeys: [] });

    // The event log records what happened; only the snapshot knows the session's name, its
    // exercises and their targets.
    expect(restored.name).toBe('Upper / Lower');
    expect(restored.exercises[0].name).toBe('Bench Press');
    expect(restored.exercises[0].sets[0].weightKg).toBe(80);
    expect(restored.exercises[1].sets[0].durationSeconds).toBe(45);
  });

  it('comes back paused when the athlete left it paused', () => {
    const restored = restoreSession(session(), { status: 'paused', completedSetKeys: [] });

    expect(restored.status).toBe('paused');
  });

  it('leaves a set open that was ticked and then unticked', () => {
    // The replay applies set_uncompleted by removing the key, so it simply is not in the list.
    const restored = restoreSession(session(), { status: 'in_progress', completedSetKeys: [] });

    expect(restored.exercises[0].sets[0].isCompleted).toBe(false);
  });

  it('round-trips a real sequence of actions through replay', () => {
    // Tick two sets, untick one -- what completeSet would have written to the log.
    const keys = ['ex-1:0', 'ex-1:1'].filter((key) => key !== 'ex-1:1');

    const restored = restoreSession(session(), { status: 'in_progress', completedSetKeys: keys });

    expect(sessionStats(restored)).toMatchObject({ completedSetCount: 1, totalSetCount: 3, volumeKg: 640 });
  });
});
