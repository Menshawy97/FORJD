import type { WorkoutSessionUploadRequest } from '@forjd/contracts';
import type { WorkoutEventType } from '@forjd/domain';

import {
  appendSessionEvent,
  clearSessionEvents,
  drainSyncQueue,
  enqueueSessionUpload,
  ensureWorkoutSessionSchema,
  getQueuedSessions,
  getSessionEvents,
  replaySessionState,
  SessionEventRecord,
} from '../workout-session';
import { SqliteConnection } from '../exercise-catalogue';

/**
 * `expo-sqlite`'s native module cannot run under plain Jest, so every function under test is
 * exercised against `FakeSqliteConnection` -- the same reasoning `exercise-catalogue.test.ts`
 * already applies. Only `openWorkoutSessionDb` touches the real API, and it is one line
 * deliberately left unwrapped and untested here; a device walk is the real check for that.
 */
class FakeSqliteConnection implements SqliteConnection {
  events: Array<{ id: number; session_id: string; type: string; occurred_at: string; payload: string }> = [];
  nextEventId = 1;
  queue = new Map<
    string,
    { payload: string; status: string; attempt_count: number; next_retry_at: string; last_error: string | null }
  >();

  execAsync(): Promise<void> {
    return Promise.resolve();
  }

  withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return task();
  }

  runAsync(source: string, params: unknown[] = []): Promise<unknown> {
    if (source.startsWith('INSERT INTO session_events')) {
      const [sessionId, type, occurredAt, payload] = params as [string, string, string, string];
      this.events.push({
        id: this.nextEventId,
        session_id: sessionId,
        type,
        occurred_at: occurredAt,
        payload,
      });
      this.nextEventId += 1;
    } else if (source.startsWith('DELETE FROM session_events')) {
      const [sessionId] = params as [string];
      this.events = this.events.filter((event) => event.session_id !== sessionId);
    } else if (source.startsWith('INSERT OR REPLACE INTO session_queue')) {
      const [sessionId, payload, nextRetryAt] = params as [string, string, string];
      this.queue.set(sessionId, { payload, status: 'pending', attempt_count: 0, next_retry_at: nextRetryAt, last_error: null });
    } else if (source.startsWith('DELETE FROM session_queue')) {
      const [sessionId] = params as [string];
      this.queue.delete(sessionId);
    } else if (source.startsWith('UPDATE session_queue SET')) {
      const [attemptCount, status, nextRetryAt, lastError, sessionId] = params as [
        number,
        string,
        string,
        string,
        string,
      ];
      const row = this.queue.get(sessionId);
      if (row) {
        row.attempt_count = attemptCount;
        row.status = status;
        row.next_retry_at = nextRetryAt;
        row.last_error = lastError;
      }
    } else {
      throw new Error(`FakeSqliteConnection: unhandled statement: ${source}`);
    }
    return Promise.resolve(undefined);
  }

  getAllAsync<T>(source: string, params: unknown[] = []): Promise<T[]> {
    if (source.startsWith('SELECT id, session_id, type, occurred_at, payload FROM session_events')) {
      const [sessionId] = params as [string];
      return Promise.resolve(
        this.events
          .filter((event) => event.session_id === sessionId)
          .sort((a, b) => a.id - b.id) as unknown as T[],
      );
    }
    if (source.startsWith('SELECT session_id, payload, status, attempt_count, next_retry_at, last_error')) {
      return Promise.resolve(
        [...this.queue.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([sessionId, row]) => ({ session_id: sessionId, ...row })) as unknown as T[],
      );
    }
    throw new Error(`FakeSqliteConnection: unhandled query: ${source}`);
  }
}

const uploadRequest = (id: string): WorkoutSessionUploadRequest => ({
  id,
  name: 'Upper Push',
  activity: 'strength',
  status: 'completed',
  startedAt: '2026-09-02T09:00:00.000Z',
  durationSeconds: 1800,
  isLiveTracked: false,
  exercises: [],
});

describe('workout-session store', () => {
  let db: FakeSqliteConnection;

  beforeEach(async () => {
    db = new FakeSqliteConnection();
    await ensureWorkoutSessionSchema(db);
  });

  describe('appendSessionEvent / getSessionEvents / clearSessionEvents', () => {
    it('returns events for a session in append order', async () => {
      await appendSessionEvent(db, 'session-1', 'set_completed', '2026-09-02T09:00:00.000Z', {
        exerciseId: 'ex-1',
        setIndex: 0,
      });
      await appendSessionEvent(db, 'session-1', 'set_completed', '2026-09-02T09:01:00.000Z', {
        exerciseId: 'ex-1',
        setIndex: 1,
      });

      const events = await getSessionEvents(db, 'session-1');

      expect(events.map((event) => event.payload)).toEqual([
        { exerciseId: 'ex-1', setIndex: 0 },
        { exerciseId: 'ex-1', setIndex: 1 },
      ]);
    });

    it("never returns another session's events", async () => {
      await appendSessionEvent(db, 'session-1', 'workout_finished', '2026-09-02T09:00:00.000Z', {});
      await appendSessionEvent(db, 'session-2', 'workout_finished', '2026-09-02T09:00:00.000Z', {});

      await expect(getSessionEvents(db, 'session-1')).resolves.toHaveLength(1);
    });

    it("removes a session's events entirely", async () => {
      await appendSessionEvent(db, 'session-1', 'workout_finished', '2026-09-02T09:00:00.000Z', {});

      await clearSessionEvents(db, 'session-1');

      await expect(getSessionEvents(db, 'session-1')).resolves.toEqual([]);
    });
  });

  describe('replaySessionState -- crash recovery', () => {
    const startedAt = new Date('2026-09-02T09:00:00.000Z');

    it('rebuilds an in-progress session from a partial log, as if the app were just killed and reopened', async () => {
      // First "session" of writes, before the simulated crash.
      await appendSessionEvent(db, 'session-1', 'set_completed', '2026-09-02T09:05:00.000Z', {
        exerciseId: 'ex-1',
        setIndex: 0,
      });
      await appendSessionEvent(db, 'session-1', 'rest_started', '2026-09-02T09:05:05.000Z', {});
      await appendSessionEvent(db, 'session-1', 'rest_completed', '2026-09-02T09:06:35.000Z', {});

      // Simulate the app being force-killed and reopened: read the log back fresh, as a cold
      // start would, rather than reusing any in-memory state from the writes above.
      const eventsAfterCrash: SessionEventRecord[] = await getSessionEvents(db, 'session-1');
      const rebuilt = replaySessionState(startedAt, eventsAfterCrash);

      expect(rebuilt.status).toBe('in_progress');
      expect(rebuilt.completedSetKeys).toEqual(['ex-1:0']);
      expect(rebuilt.durationSeconds).toBe(6 * 60 + 35);
    });

    it('excludes paused time from duration, and reports paused status while paused', async () => {
      await appendSessionEvent(db, 'session-1', 'set_completed', '2026-09-02T09:05:00.000Z', {
        exerciseId: 'ex-1',
        setIndex: 0,
      });
      await appendSessionEvent(db, 'session-1', 'workout_paused', '2026-09-02T09:10:00.000Z', {});

      const pausedState = replaySessionState(startedAt, await getSessionEvents(db, 'session-1'));
      expect(pausedState.status).toBe('paused');
      expect(pausedState.durationSeconds).toBe(10 * 60);

      // Resumed 5 minutes later, after another simulated crash/reopen in between.
      await appendSessionEvent(db, 'session-1', 'workout_resumed', '2026-09-02T09:15:00.000Z', {});
      await appendSessionEvent(db, 'session-1', 'set_completed', '2026-09-02T09:16:00.000Z', {
        exerciseId: 'ex-1',
        setIndex: 1,
      });
      await appendSessionEvent(db, 'session-1', 'workout_finished', '2026-09-02T09:16:00.000Z', {});

      const finalState = replaySessionState(startedAt, await getSessionEvents(db, 'session-1'));
      expect(finalState.status).toBe('completed');
      expect(finalState.completedSetKeys).toEqual(['ex-1:0', 'ex-1:1']);
      // 16 minutes elapsed minus the 5-minute paused window = 11 minutes.
      expect(finalState.durationSeconds).toBe(11 * 60);
    });

    it('returns a zero-duration, in-progress state for an empty log', () => {
      const state = replaySessionState(startedAt, []);

      expect(state).toEqual({ status: 'in_progress', durationSeconds: 0, completedSetKeys: [] });
    });

    it('ignores rest and exercise-completed events for status/duration bookkeeping', () => {
      const events: SessionEventRecord[] = (['rest_started', 'rest_completed', 'exercise_completed'] as WorkoutEventType[]).map(
        (type, index) => ({
          id: index,
          sessionId: 'session-1',
          type,
          occurredAt: '2026-09-02T09:05:00.000Z',
          payload: {},
        }),
      );

      const state = replaySessionState(startedAt, events);

      expect(state.status).toBe('in_progress');
    });
  });

  describe('enqueueSessionUpload / getQueuedSessions / drainSyncQueue', () => {
    it('uploads a pending session and removes it from the queue and its event log', async () => {
      const payload = uploadRequest('session-1');
      await appendSessionEvent(db, 'session-1', 'workout_finished', '2026-09-02T09:30:00.000Z', {});
      await enqueueSessionUpload(db, payload);

      const uploaded: WorkoutSessionUploadRequest[] = [];
      const result = await drainSyncQueue(db, async (body) => {
        uploaded.push(body);
      });

      expect(result).toEqual({ uploaded: ['session-1'], failed: [] });
      expect(uploaded).toEqual([payload]);
      await expect(getQueuedSessions(db)).resolves.toEqual([]);
      await expect(getSessionEvents(db, 'session-1')).resolves.toEqual([]);
    });

    it('is idempotent: a session that fails to upload stays queued and is uploaded exactly once on eventual success', async () => {
      await enqueueSessionUpload(db, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      let attempts = 0;
      const failThenSucceed = async (): Promise<void> => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('network error');
        }
      };

      const firstDrain = await drainSyncQueue(db, failThenSucceed, new Date('2026-09-02T09:00:00.000Z'));
      expect(firstDrain).toEqual({ uploaded: [], failed: ['session-1'] });
      const afterFirstFailure = await getQueuedSessions(db);
      expect(afterFirstFailure[0]?.status).toBe('pending');
      expect(afterFirstFailure[0]?.attemptCount).toBe(1);

      // Drained again before the backoff window elapses: skipped, no second upload attempt.
      const tooSoon = await drainSyncQueue(db, failThenSucceed, new Date('2026-09-02T09:00:00.500Z'));
      expect(tooSoon).toEqual({ uploaded: [], failed: [] });
      expect(attempts).toBe(1);

      // Drained again after the backoff window: succeeds, and the row is gone for good.
      const secondDrain = await drainSyncQueue(db, failThenSucceed, new Date('2026-09-02T09:00:05.000Z'));
      expect(secondDrain).toEqual({ uploaded: ['session-1'], failed: [] });
      expect(attempts).toBe(2);
      await expect(getQueuedSessions(db)).resolves.toEqual([]);

      // A third drain call must not upload it a third time -- it is simply no longer queued.
      const thirdDrain = await drainSyncQueue(db, failThenSucceed, new Date('2026-09-02T10:00:00.000Z'));
      expect(thirdDrain).toEqual({ uploaded: [], failed: [] });
      expect(attempts).toBe(2);
    });

    it('stops retrying automatically after the max attempt count, without deleting the row', async () => {
      await enqueueSessionUpload(db, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      const alwaysFail = async (): Promise<void> => {
        throw new Error('permanently broken');
      };

      let now = new Date('2026-09-02T09:00:00.000Z');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await drainSyncQueue(db, alwaysFail, now);
        now = new Date(now.getTime() + 31 * 60_000);
      }

      const rows = await getQueuedSessions(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.attemptCount).toBe(5);

      // A failed row is skipped entirely on the next drain -- no further upload attempt.
      let calls = 0;
      await drainSyncQueue(
        db,
        async () => {
          calls += 1;
        },
        new Date(now.getTime() + 60 * 60_000),
      );
      expect(calls).toBe(0);
    });

    it('leaves a not-yet-due row queued without attempting it', async () => {
      await enqueueSessionUpload(db, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      let calls = 0;
      const result = await drainSyncQueue(
        db,
        async () => {
          calls += 1;
        },
        new Date('2026-09-02T08:59:59.000Z'),
      );

      expect(result).toEqual({ uploaded: [], failed: [] });
      expect(calls).toBe(0);
    });
  });
});
