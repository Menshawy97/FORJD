// 12B-2b. The live session, held outside the live screen so it survives leaving it: start, restore,
// apply (log first), pause accounting, discard. Storage, location and the clock are injected fakes.
import {
  completeSet,
  finishSession,
  pauseSession,
  resumeSession,
  type LiveSession,
} from '../live-session';
import { createActiveWorkout, type ActiveWorkoutDeps, type ActiveWorkoutState } from '../active-workout';

const T0 = Date.UTC(2026, 9, 4, 10, 0, 0);

const pending = {
  id: 'session-1',
  templateId: null,
  name: 'Push Day',
  activity: 'strength' as const,
  exercises: [
    {
      exerciseId: 'bench',
      name: 'Bench Press',
      measure: 'weight' as const,
      goal: null,
      sets: [
        { setIndex: 0, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
        { setIndex: 1, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
      ],
    },
  ],
};

interface Harness {
  workout: ReturnType<typeof createActiveWorkout>;
  clock: { now: number };
  storage: Record<keyof ActiveWorkoutDeps['storage'], jest.Mock>;
  location: jest.Mock<Promise<{ latitude: number; longitude: number } | null>, []>;
  events: () => string[];
}

function harness(over: { db?: unknown | null; snapshot?: unknown; storedEvents?: unknown[]; replay?: unknown } = {}): Harness {
  const clock = { now: T0 };
  const db = over.db === undefined ? {} : over.db;
  const storage = {
    appendSessionEvent: jest.fn().mockResolvedValue(undefined),
    saveSessionSnapshot: jest.fn().mockResolvedValue(undefined),
    getUnfinishedSessionSnapshot: jest.fn().mockResolvedValue(over.snapshot ?? null),
    getSessionEvents: jest.fn().mockResolvedValue(over.storedEvents ?? []),
    replaySessionState: jest.fn().mockReturnValue(over.replay ?? { status: 'in_progress', durationSeconds: 0, completedSetKeys: [] }),
    clearSessionSnapshot: jest.fn().mockResolvedValue(undefined),
    clearSessionEvents: jest.fn().mockResolvedValue(undefined),
    enqueueSessionUpload: jest.fn().mockResolvedValue(undefined),
  };
  const location = jest.fn<Promise<{ latitude: number; longitude: number } | null>, []>().mockResolvedValue(null);
  const workout = createActiveWorkout({
    storage: storage as unknown as ActiveWorkoutDeps['storage'],
    getDb: async () => db as never,
    getAccountId: async () => 'account-1',
    captureStartLocation: location,
    now: () => clock.now,
  });
  return {
    workout,
    clock,
    storage,
    location,
    events: () => storage.appendSessionEvent.mock.calls.map((call) => call[2] as string),
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const session = (h: Harness): LiveSession => h.workout.getState().session!;

describe('starting', () => {
  it('holds the session, starts its clock now and saves a snapshot of it once', async () => {
    const h = harness();
    const started = h.workout.start(pending);
    await settle();

    expect(h.workout.getState()).toMatchObject({ resumed: false, pausedMs: 0, pausedSince: null, isLogging: true });
    expect(started.startedAt.getTime()).toBe(T0);
    expect(session(h).name).toBe('Push Day');
    expect(h.storage.saveSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(h.storage.saveSessionSnapshot.mock.calls[0]![1]).toBe('account-1');
    expect(h.storage.saveSessionSnapshot.mock.calls[0]![2]).toBe('session-1');
  });

  it('adds the start position when it arrives, and saves the snapshot again with it', async () => {
    const h = harness();
    h.location.mockResolvedValue({ latitude: 30.04, longitude: 31.23 });
    h.workout.start(pending);
    await settle();

    expect(session(h).startLocation).toEqual({ latitude: 30.04, longitude: 31.23 });
    expect(h.storage.saveSessionSnapshot).toHaveBeenCalledTimes(2);
  });

  it('drops a start position that arrives after Finish', async () => {
    const h = harness();
    let arrive: (p: { latitude: number; longitude: number }) => void = () => undefined;
    h.location.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    h.workout.start(pending);
    h.workout.markFinishing();
    arrive({ latitude: 1, longitude: 2 });
    await settle();

    expect(session(h).startLocation).toBeUndefined();
  });

  it('never throws when storage or location fail: the workout still runs', async () => {
    const h = harness({ db: null });
    h.location.mockRejectedValue(new Error('gps'));

    expect(() => h.workout.start(pending)).not.toThrow();
    await settle();
    expect(session(h).id).toBe('session-1');
  });
});

describe('apply', () => {
  it('writes the events to the log and adopts the session', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();
    const change = completeSet(session(h), 0, 0, new Date(T0 + 1000));

    h.workout.apply(change);
    await settle();

    expect(h.events()).toEqual(['set_completed', 'rest_started']);
    expect(session(h).exercises[0]!.sets[0]!.isCompleted).toBe(true);
  });

  it('ignores a refused change: nothing is logged and the session is untouched', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();
    const before = session(h);
    const refused = completeSet(before, 0, 1, new Date(T0));

    h.workout.apply(refused);
    await settle();

    expect(refused.refusal).not.toBeNull();
    expect(h.events()).toEqual([]);
    expect(session(h)).toBe(before);
  });

  it('writes events strictly in order, even when applied back to back', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();
    h.workout.apply(completeSet(session(h), 0, 0, new Date(T0)));
    h.workout.apply(completeSet(session(h), 0, 1, new Date(T0)));
    await settle();

    expect(h.events()).toEqual(['set_completed', 'rest_started', 'set_completed', 'exercise_completed', 'rest_started']);
  });

  it('flags a failed log write instead of swallowing it, and recovers on the next good one', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();
    h.storage.appendSessionEvent.mockRejectedValueOnce(new Error('disk'));
    h.workout.apply(completeSet(session(h), 0, 0, new Date(T0)));
    await settle();

    expect(h.workout.getState().isLogging).toBe(false);
    expect(h.workout.getState().logFailures).toBe(1);

    h.workout.apply(completeSet(session(h), 0, 1, new Date(T0)));
    await settle();
    expect(h.workout.getState().isLogging).toBe(true);
  });

  it('flags the log as not saving when the local database cannot be opened', async () => {
    const h = harness({ db: null });
    h.workout.start(pending);
    h.workout.apply(completeSet(session(h), 0, 0, new Date(T0)));
    await settle();

    expect(h.workout.getState().isLogging).toBe(false);
    expect(session(h).exercises[0]!.sets[0]!.isCompleted).toBe(true);
  });

  it('tells subscribers about each change, with the change itself', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();
    const seen: Array<[ActiveWorkoutState, unknown]> = [];
    h.workout.subscribe((state, change) => seen.push([state, change]));

    const change = completeSet(session(h), 0, 0, new Date(T0));
    h.workout.apply(change);

    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toBe(change);
  });

  it('does nothing without a workout', () => {
    const h = harness();
    expect(() =>
      h.workout.apply({ session: {} as LiveSession, events: [], restStartedSeconds: null, opensTimerFor: null, refusal: null }),
    ).not.toThrow();
    expect(h.workout.getState().session).toBeNull();
  });
});

describe('the clock and pausing', () => {
  it('counts elapsed seconds from the start', () => {
    const h = harness();
    h.workout.start(pending);
    h.clock.now = T0 + 95_000;

    expect(h.workout.elapsedSeconds(h.clock.now)).toBe(95);
  });

  it('stops counting while paused and carries on, without the paused stretch, after a resume', () => {
    const h = harness();
    h.workout.start(pending);
    h.clock.now = T0 + 60_000;
    h.workout.apply(pauseSession(session(h), new Date(h.clock.now)));
    h.clock.now = T0 + 160_000;
    expect(h.workout.elapsedSeconds(h.clock.now)).toBe(60);

    h.workout.apply(resumeSession(session(h), new Date(h.clock.now)));
    expect(h.workout.getState().pausedMs).toBe(100_000);
    h.clock.now = T0 + 190_000;
    expect(h.workout.elapsedSeconds(h.clock.now)).toBe(90);
  });

  it('is zero with no workout, never negative', () => {
    const h = harness();
    expect(h.workout.elapsedSeconds(T0)).toBe(0);
  });
});

describe('unlogged edits', () => {
  it('updates the session without writing to the log', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();

    h.workout.update((current) => ({ ...current, restSeconds: 105 }));

    expect(session(h).restSeconds).toBe(105);
    expect(h.storage.appendSessionEvent).not.toHaveBeenCalled();
  });

  it('applies each edit to the latest session, so two edits in a row both land', () => {
    const h = harness();
    h.workout.start(pending);
    h.workout.update((current) => ({ ...current, restSeconds: 100 }));
    h.workout.update((current) => ({ ...current, restSeconds: current.restSeconds + 15 }));

    expect(session(h).restSeconds).toBe(115);
  });
});

describe('restoring after the app was closed', () => {
  const snapshot = {
    sessionId: 'session-1',
    startedAt: new Date(T0).toISOString(),
    payload: { ...pending, status: 'in_progress', restSeconds: 90, startedAt: new Date(T0).toISOString() },
  };

  it('rebuilds the session from its snapshot and the replayed log, and counts the dead time as paused', async () => {
    const h = harness({
      snapshot,
      replay: { status: 'in_progress', durationSeconds: 300, completedSetKeys: ['bench:0'] },
    });
    h.clock.now = T0 + 3_600_000;

    const restored = await h.workout.restore();

    expect(restored).toBe(true);
    expect(session(h).exercises[0]!.sets[0]!.isCompleted).toBe(true);
    expect(h.workout.getState().resumed).toBe(true);
    expect(h.workout.elapsedSeconds(h.clock.now)).toBe(300);
  });

  it('offers nothing when there is no unfinished workout', async () => {
    const h = harness();

    expect(await h.workout.restore()).toBe(false);
    expect(h.workout.getState().session).toBeNull();
  });

  it('clears a workout whose log says it already finished, and does not restore it', async () => {
    const h = harness({ snapshot, replay: { status: 'completed', durationSeconds: 10, completedSetKeys: [] } });

    expect(await h.workout.restore()).toBe(false);
    expect(h.storage.clearSessionSnapshot).toHaveBeenCalledWith(expect.anything(), 'session-1');
  });

  it('does not replace a workout that is already running', async () => {
    const h = harness({ snapshot });
    h.workout.start(pending);

    expect(await h.workout.restore()).toBe(false);
    expect(h.storage.getUnfinishedSessionSnapshot).not.toHaveBeenCalled();
  });

  it('restores once when asked twice at the same time', async () => {
    const h = harness({ snapshot });

    await Promise.all([h.workout.restore(), h.workout.restore()]);

    expect(h.storage.getUnfinishedSessionSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('ending', () => {
  it('discard deletes the snapshot and the log, and leaves no workout', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();

    await h.workout.discard();

    expect(h.storage.clearSessionSnapshot).toHaveBeenCalledWith(expect.anything(), 'session-1');
    expect(h.storage.clearSessionEvents).toHaveBeenCalledWith(expect.anything(), 'session-1');
    expect(h.workout.getState().session).toBeNull();
  });

  it('discard waits for pending log writes so none lands after the delete', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();
    let release: () => void = () => undefined;
    h.storage.appendSessionEvent.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    h.workout.apply(completeSet(session(h), 0, 0, new Date(T0)));
    await settle();

    const done = h.workout.discard();
    await settle();
    expect(h.storage.clearSessionEvents).not.toHaveBeenCalled();
    release();
    await done;

    expect(h.storage.clearSessionEvents).toHaveBeenCalled();
  });

  it('clear leaves no workout, once it has been queued for upload', () => {
    const h = harness();
    h.workout.start(pending);
    h.workout.apply(finishSession(session(h), new Date(T0 + 1000)));

    h.workout.clear();

    expect(h.workout.getState().session).toBeNull();
  });

  it('a workout that is finished is no longer active', () => {
    const h = harness();
    expect(h.workout.isActive()).toBe(false);
    h.workout.start(pending);
    expect(h.workout.isActive()).toBe(true);
    h.workout.apply(finishSession(session(h), new Date(T0 + 1000)));
    expect(h.workout.isActive()).toBe(false);
  });
});

describe('queueing a finished workout for upload', () => {
  const request = { id: 'session-1' } as never;

  it('queues it for the signed-in account, then clears the snapshot that offered it back', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();
    const order: string[] = [];
    h.storage.enqueueSessionUpload.mockImplementation(async () => {
      order.push('enqueue');
    });
    h.storage.clearSessionSnapshot.mockImplementation(async () => {
      order.push('clear');
    });

    await h.workout.queueForUpload(request);

    expect(h.storage.enqueueSessionUpload).toHaveBeenCalledWith(expect.anything(), 'account-1', request);
    expect(order).toEqual(['enqueue', 'clear']);
  });

  it('waits for the log writes first, so the upload never outruns its own events', async () => {
    const h = harness();
    h.workout.start(pending);
    await settle();
    let release: () => void = () => undefined;
    h.storage.appendSessionEvent.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    h.workout.apply(finishSession(session(h), new Date(T0 + 1000)));
    await settle();

    const done = h.workout.queueForUpload(request);
    await settle();
    expect(h.storage.enqueueSessionUpload).not.toHaveBeenCalled();
    release();
    await done;

    expect(h.storage.enqueueSessionUpload).toHaveBeenCalled();
  });

  it('rejects when the local database is unavailable, so Finish can tell the athlete it did not save', async () => {
    const h = harness({ db: null });
    h.workout.start(pending);

    await expect(h.workout.queueForUpload(request)).rejects.toThrow();
    expect(h.storage.clearSessionSnapshot).not.toHaveBeenCalled();
  });

  it('rejects when queueing fails, and leaves the snapshot so the workout is not lost', async () => {
    const h = harness();
    h.workout.start(pending);
    h.storage.enqueueSessionUpload.mockRejectedValue(new Error('disk'));

    await expect(h.workout.queueForUpload(request)).rejects.toThrow('disk');
    expect(h.storage.clearSessionSnapshot).not.toHaveBeenCalled();
  });
});
