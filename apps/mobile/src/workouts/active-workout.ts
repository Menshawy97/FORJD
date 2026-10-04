import type { WorkoutSessionUploadRequest } from '@forjd/contracts';

import type { PendingLiveSession } from './live-handoff';
import {
  restoreSession,
  startSession,
  type LiveSession,
  type LiveSessionChange,
  type PendingEvent,
} from './live-session';

/**
 * The workout in progress, held outside the live screen (12B-2b).
 *
 * It used to live in `live.tsx`'s React state, so pressing back ended it: the screen unmounted and the
 * session with it. Held here it lives until the athlete finishes or discards it, which is what lets the
 * in-app bar and the lock-screen notice keep showing it, and lets either of them act on it.
 *
 * **Nothing in this file touches React, SQLite or the network directly.** Storage, the start position and
 * the clock arrive as dependencies, the seam every other piece of the live flow uses, so the whole of it
 * is tested without a database (CLAUDE.md rule 6: the live session never waits on the network).
 *
 * **The log stays the source of truth.** `apply` writes a change's events before it describes the session
 * to anyone, in order, so a state that was never logged cannot outlive a crash; `restore` is the path
 * back from one. A failed write is counted and shown, never swallowed (a set that looks done but was not
 * logged is the corruption the log exists to prevent), and the workout keeps running regardless.
 */
export interface ActiveWorkoutState {
  session: LiveSession | null;
  /** Milliseconds spent paused, in stretches that have ended. */
  pausedMs: number;
  /** When the current pause began, or null while the workout runs. */
  pausedSince: number | null;
  /** False once a log write has failed, until the next one succeeds. */
  isLogging: boolean;
  /** How many writes have failed: the screen toasts when it goes up. */
  logFailures: number;
  /** True when this session was picked back up after the app closed, rather than started now. */
  resumed: boolean;
}

export type ActiveWorkoutListener = (state: ActiveWorkoutState, change: LiveSessionChange | null) => void;

/** The slice of `@/store/workout-session` this uses, so it can be faked. */
export interface ActiveWorkoutStorage {
  appendSessionEvent: (
    db: never,
    sessionId: string,
    type: PendingEvent['type'],
    occurredAt: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  saveSessionSnapshot: (
    db: never,
    accountId: string | null,
    sessionId: string,
    payload: Record<string, unknown>,
    startedAt: string,
  ) => Promise<unknown>;
  getUnfinishedSessionSnapshot: (
    db: never,
    accountId: string | null,
  ) => Promise<{ sessionId: string; payload: Record<string, unknown>; startedAt: string } | null>;
  getSessionEvents: (db: never, sessionId: string) => Promise<never[]>;
  replaySessionState: (
    startedAt: Date,
    events: never[],
  ) => { status: LiveSession['status']; durationSeconds: number; completedSetKeys: string[] };
  clearSessionSnapshot: (db: never, sessionId: string) => Promise<unknown>;
  clearSessionEvents: (db: never, sessionId: string) => Promise<unknown>;
  enqueueSessionUpload: (
    db: never,
    accountId: string | null,
    request: WorkoutSessionUploadRequest,
  ) => Promise<unknown>;
}

export interface ActiveWorkoutDeps {
  storage: ActiveWorkoutStorage;
  /** The opened log database, or null when it cannot be opened (the workout then runs unlogged). */
  getDb: () => Promise<never | null>;
  getAccountId: () => Promise<string | null>;
  /** One coarse position for the leaderboard (ADR-048): never awaited by the workout, never prompts. */
  captureStartLocation: () => Promise<{ latitude: number; longitude: number } | null>;
  now?: () => number;
}

export interface ActiveWorkout {
  getState: () => ActiveWorkoutState;
  subscribe: (listener: ActiveWorkoutListener) => () => void;
  /** A workout that is running or paused: not finished, not absent. */
  isActive: () => boolean;
  /** Working time in whole seconds: wall-clock since the start, less every paused stretch. */
  elapsedSeconds: (nowMs: number) => number;
  start: (pending: PendingLiveSession) => LiveSession;
  /** Picks an unfinished workout back up from its snapshot and log. False when there is none to pick up. */
  restore: () => Promise<boolean>;
  /** Logs a change's events, then adopts its session. A refused change is ignored. */
  apply: (change: LiveSessionChange) => void;
  /** An edit that is not logged (a target weight, a unit, the rest length): nothing was performed yet. */
  update: (edit: (session: LiveSession) => LiveSession) => void;
  /** Finish was pressed: a start position that arrives later must not be written back. */
  markFinishing: () => void;
  /**
   * Hands a finished workout to the upload queue, then clears the snapshot that would offer it back. Rejects
   * when it could not be queued, so Finish can say so: the workout is then still here, and nothing is lost.
   */
  queueForUpload: (request: WorkoutSessionUploadRequest) => Promise<void>;
  /** Throws the workout away: its snapshot and log are deleted and nothing is uploaded. */
  discard: () => Promise<void>;
  /** Forgets the workout once it is queued for upload. */
  clear: () => void;
}

const EMPTY: ActiveWorkoutState = {
  session: null,
  pausedMs: 0,
  pausedSince: null,
  isLogging: true,
  logFailures: 0,
  resumed: false,
};

export function createActiveWorkout(deps: ActiveWorkoutDeps): ActiveWorkout {
  const now = deps.now ?? (() => Date.now());
  const listeners = new Set<ActiveWorkoutListener>();
  let state: ActiveWorkoutState = EMPTY;
  let finishing = false;
  let restoring: Promise<boolean> | null = null;
  /** Log writes, chained so they land in the order they were applied. */
  let writes: Promise<void> = Promise.resolve();
  /**
   * The log database, opened once per workout and shared, so every write queues behind the open instead of
   * racing it. A failed open is not remembered: the next write tries again rather than staying unlogged.
   */
  let database: Promise<never | null> | null = null;
  const getDb = (): Promise<never | null> => {
    database ??= deps
      .getDb()
      .catch(() => null)
      .then((db) => {
        if (db === null) database = null;
        return db;
      });
    return database;
  };

  const set = (next: ActiveWorkoutState, change: LiveSessionChange | null = null) => {
    // No workout, or a new one: the next write opens the database afresh.
    if (next.session === null) database = null;
    state = next;
    listeners.forEach((listener) => listener(state, change));
  };

  const persist = (sessionId: string, events: PendingEvent[]) => {
    if (events.length === 0) return;
    writes = writes.then(async () => {
      try {
        const db = await getDb();
        if (!db) {
          set({ ...state, isLogging: false, logFailures: state.logFailures + 1 });
          return;
        }
        for (const event of events) {
          await deps.storage.appendSessionEvent(db, sessionId, event.type, event.occurredAt, event.payload);
        }
        if (!state.isLogging) set({ ...state, isLogging: true });
      } catch {
        set({ ...state, isLogging: false, logFailures: state.logFailures + 1 });
      }
    });
  };

  const saveSnapshot = async (session: LiveSession) => {
    try {
      const db = await getDb();
      if (!db) return;
      await deps.storage.saveSessionSnapshot(
        db,
        await deps.getAccountId(),
        session.id,
        session as unknown as Record<string, unknown>,
        session.startedAt.toISOString(),
      );
    } catch {
      // Crash recovery for this session is degraded, not lost: the workout keeps running from memory.
    }
  };

  const attachStartLocation = async (sessionId: string) => {
    const position = await deps.captureStartLocation().catch(() => null);
    const current = state.session;
    if (!position || finishing || !current || current.id !== sessionId) return;
    const withPosition = { ...current, startLocation: position };
    set({ ...state, session: withPosition });
    // Written into the snapshot too, so a force-kill keeps it.
    await saveSnapshot(withPosition);
  };

  const isActive = () => state.session !== null && state.session.status !== 'completed';

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isActive,
    elapsedSeconds: (nowMs) => {
      const { session, pausedMs, pausedSince } = state;
      if (!session) return 0;
      const paused = pausedMs + (pausedSince === null ? 0 : nowMs - pausedSince);
      return Math.max(0, Math.floor((nowMs - session.startedAt.getTime() - paused) / 1000));
    },
    start: (pending) => {
      finishing = false;
      database = null;
      const started = startSession({
        id: pending.id,
        templateId: pending.templateId,
        name: pending.name,
        activity: pending.activity,
        startedAt: new Date(now()),
        exercises: pending.exercises,
      });
      set({ ...EMPTY, session: started });
      // Snapshot once, at start: the mutable part of a session is what the event log already carries.
      void saveSnapshot(started);
      void attachStartLocation(started.id);
      return started;
    },
    restore: () => {
      if (state.session) return Promise.resolve(false);
      restoring ??= (async () => {
        try {
          const db = await getDb();
          if (!db) return false;
          const snapshot = await deps.storage.getUnfinishedSessionSnapshot(db, await deps.getAccountId());
          if (!snapshot || state.session) return false;
          const startedAt = new Date(snapshot.startedAt);
          const events = await deps.storage.getSessionEvents(db, snapshot.sessionId);
          const replayed = deps.storage.replaySessionState(startedAt, events);
          if (replayed.status === 'completed') {
            // Already finished: it belongs to the sync queue, not to another workout.
            await deps.storage.clearSessionSnapshot(db, snapshot.sessionId);
            return false;
          }
          if (state.session) return false;
          const stored = snapshot.payload as unknown as LiveSession;
          const session = restoreSession({ ...stored, startedAt }, replayed);
          /**
           * The stretch the app was closed for counts as **paused**, not as training: the replay gives
           * the working time up to the last logged event, and seeding the paused total with the
           * difference makes the clock read exactly that on return and tick on from there.
           */
          const pausedMs = Math.max(0, now() - startedAt.getTime() - replayed.durationSeconds * 1000);
          finishing = false;
          set({ ...EMPTY, session, pausedMs, resumed: true });
          return true;
        } catch {
          return false;
        } finally {
          restoring = null;
        }
      })();
      return restoring;
    },
    apply: (change) => {
      const current = state.session;
      if (change.refusal || !current) return;
      persist(change.session.id, change.events);
      let { pausedMs, pausedSince } = state;
      if (current.status === 'in_progress' && change.session.status === 'paused') {
        pausedSince = now();
      } else if (current.status === 'paused' && change.session.status !== 'paused' && pausedSince !== null) {
        pausedMs += now() - pausedSince;
        pausedSince = null;
      }
      set({ ...state, session: change.session, pausedMs, pausedSince }, change);
    },
    update: (edit) => {
      if (!state.session) return;
      set({ ...state, session: edit(state.session) });
    },
    markFinishing: () => {
      finishing = true;
    },
    queueForUpload: async (request) => {
      // Behind every log write, so the upload never outruns the events it summarises.
      await writes;
      const db = await getDb();
      if (!db) throw new Error('Local database unavailable');
      // The one place a finished workout reaches the sync queue.
      await deps.storage.enqueueSessionUpload(db, await deps.getAccountId(), request);
      // The snapshot exists only to recover an unfinished workout; leaving it would offer this one back.
      await deps.storage.clearSessionSnapshot(db, request.id);
    },
    discard: async () => {
      const current = state.session;
      if (!current) return;
      finishing = true;
      try {
        // Behind any write still in flight, so none lands after the delete and revives the log.
        await writes;
        const db = await getDb();
        if (db) {
          await deps.storage.clearSessionSnapshot(db, current.id);
          await deps.storage.clearSessionEvents(db, current.id);
        }
      } catch {
        // A leftover snapshot is offered back on the next launch; the athlete can discard it again.
      } finally {
        set(EMPTY);
      }
    },
    clear: () => {
      set(EMPTY);
    },
  };
}

/** The real storage, required lazily so a screen that never starts a workout never loads SQLite. */
function realStorage() {
  return require('@/store/workout-session') as typeof import('@/store/workout-session');
}

export const activeWorkout = createActiveWorkout({
  storage: {
    appendSessionEvent: (db, ...rest) => realStorage().appendSessionEvent(db, ...rest),
    saveSessionSnapshot: (db, ...rest) => realStorage().saveSessionSnapshot(db, ...rest),
    getUnfinishedSessionSnapshot: (db, accountId) => realStorage().getUnfinishedSessionSnapshot(db, accountId),
    getSessionEvents: (db, sessionId) => realStorage().getSessionEvents(db, sessionId) as Promise<never[]>,
    replaySessionState: (startedAt, events) => realStorage().replaySessionState(startedAt, events),
    clearSessionSnapshot: (db, sessionId) => realStorage().clearSessionSnapshot(db, sessionId),
    clearSessionEvents: (db, sessionId) => realStorage().clearSessionEvents(db, sessionId),
    enqueueSessionUpload: (db, accountId, request) => realStorage().enqueueSessionUpload(db, accountId, request),
  },
  getDb: async () => {
    try {
      const store = realStorage();
      const db = await store.openWorkoutSessionDb();
      await store.ensureWorkoutSessionSchema(db);
      return db as never;
    } catch {
      // A session must still be runnable when the local store cannot be opened: losing crash recovery
      // is bad, but blocking the workout on it would be worse.
      return null;
    }
  },
  getAccountId: () => (require('@/auth/secureStorage') as typeof import('@/auth/secureStorage')).getAccountId(),
  captureStartLocation: () =>
    (require('./capture-start-location') as typeof import('./capture-start-location')).captureStartLocation(),
});
