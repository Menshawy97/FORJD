import type { WorkoutSessionUploadRequest } from '@forjd/contracts';
import type { WorkoutEventType } from '@forjd/domain';

import {
  appendSessionEvent,
  clearSessionEvents,
  drainSyncQueue,
  enqueueSessionUpload,
  ensureWorkoutSessionSchema,
  getFailedSessions,
  getQueuedSessions,
  getSessionEvents,
  getUnfinishedSessionSnapshot,
  replaySessionState,
  retryFailedSession,
  saveSessionSnapshot,
  SessionEventRecord,
  UploadRejection,
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
    {
      payload: string;
      status: string;
      attempt_count: number;
      next_retry_at: string;
      last_error: string | null;
      account_id: string | null;
    }
  >();
  snapshots = new Map<string, { payload: string; started_at: string; account_id: string | null }>();
  /** Backs `PRAGMA user_version` -- see the `schema versioning (R25)` tests below. */
  userVersion: number;

  constructor(userVersion = 0) {
    this.userVersion = userVersion;
  }

  /** Every statement passed to `execAsync`, so a migration step's SQL can be asserted. */
  executed: string[] = [];

  execAsync(source: string): Promise<void> {
    this.executed.push(source);
    const versionMatch = /^\s*PRAGMA user_version\s*=\s*(\d+)/.exec(source);
    if (versionMatch) {
      this.userVersion = Number(versionMatch[1]);
    }
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
      const [sessionId, payload, nextRetryAt, accountId] = params as [string, string, string, string | null];
      this.queue.set(sessionId, {
        payload,
        status: 'pending',
        attempt_count: 0,
        next_retry_at: nextRetryAt,
        last_error: null,
        account_id: accountId,
      });
    } else if (source.startsWith('INSERT OR REPLACE INTO session_snapshot')) {
      const [sessionId, payload, startedAt, accountId] = params as [string, string, string, string | null];
      this.snapshots.set(sessionId, { payload, started_at: startedAt, account_id: accountId });
    } else if (source.startsWith('DELETE FROM session_queue')) {
      const [sessionId] = params as [string];
      this.queue.delete(sessionId);
    } else if (source.includes('attempt_count = 0')) {
      // retryFailedSession: reset a failed row back to pending.
      const [nextRetryAt, sessionId] = params as [string, string];
      const row = this.queue.get(sessionId);
      if (row) {
        row.status = 'pending';
        row.attempt_count = 0;
        row.next_retry_at = nextRetryAt;
        row.last_error = null;
      }
    } else if (source.startsWith('UPDATE session_queue SET status = ?, next_retry_at = ?')) {
      const [status, nextRetryAt, sessionId] = params as [string, string, string];
      const row = this.queue.get(sessionId);
      if (row) {
        row.status = status;
        row.next_retry_at = nextRetryAt;
      }
    } else {
      throw new Error(`FakeSqliteConnection: unhandled statement: ${source}`);
    }
    return Promise.resolve(undefined);
  }

  getAllAsync<T>(source: string, params: unknown[] = []): Promise<T[]> {
    if (source.trim() === 'PRAGMA user_version') {
      return Promise.resolve([{ user_version: this.userVersion }] as unknown as T[]);
    }
    if (source.startsWith('UPDATE session_queue SET attempt_count = attempt_count + 1')) {
      const [lastError, sessionId] = params as [string, string];
      const row = this.queue.get(sessionId);
      if (!row) return Promise.resolve([] as unknown as T[]);
      row.attempt_count += 1;
      row.last_error = lastError;
      return Promise.resolve([{ attempt_count: row.attempt_count }] as unknown as T[]);
    }
    if (source.startsWith('SELECT id, session_id, type, occurred_at, payload FROM session_events')) {
      const [sessionId] = params as [string];
      return Promise.resolve(
        this.events
          .filter((event) => event.session_id === sessionId)
          .sort((a, b) => a.id - b.id) as unknown as T[],
      );
    }
    if (source.startsWith('SELECT session_id, payload, started_at, account_id FROM session_snapshot')) {
      return Promise.resolve(
        [...this.snapshots.entries()]
          .map(([sessionId, row]) => ({ session_id: sessionId, ...row }))
          .sort((a, b) => b.started_at.localeCompare(a.started_at)) as unknown as T[],
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

const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';

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
      await enqueueSessionUpload(db, ACCOUNT_A, payload);

      const uploaded: WorkoutSessionUploadRequest[] = [];
      const result = await drainSyncQueue(db, ACCOUNT_A, async (body) => {
        uploaded.push(body);
      });

      expect(result).toEqual({ uploaded: ['session-1'], failed: [] });
      expect(uploaded).toEqual([payload]);
      await expect(getQueuedSessions(db)).resolves.toEqual([]);
      await expect(getSessionEvents(db, 'session-1')).resolves.toEqual([]);
    });

    it('is idempotent: a session that fails to upload stays queued and is uploaded exactly once on eventual success', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      let attempts = 0;
      const failThenSucceed = async (): Promise<void> => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('network error');
        }
      };

      const firstDrain = await drainSyncQueue(db, ACCOUNT_A, failThenSucceed, new Date('2026-09-02T09:00:00.000Z'));
      expect(firstDrain).toEqual({ uploaded: [], failed: ['session-1'] });
      const afterFirstFailure = await getQueuedSessions(db);
      expect(afterFirstFailure[0]?.status).toBe('pending');
      expect(afterFirstFailure[0]?.attemptCount).toBe(1);

      // Drained again before the backoff window elapses: skipped, no second upload attempt.
      const tooSoon = await drainSyncQueue(db, ACCOUNT_A, failThenSucceed, new Date('2026-09-02T09:00:00.500Z'));
      expect(tooSoon).toEqual({ uploaded: [], failed: [] });
      expect(attempts).toBe(1);

      // Drained again after the backoff window: succeeds, and the row is gone for good.
      const secondDrain = await drainSyncQueue(db, ACCOUNT_A, failThenSucceed, new Date('2026-09-02T09:00:05.000Z'));
      expect(secondDrain).toEqual({ uploaded: ['session-1'], failed: [] });
      expect(attempts).toBe(2);
      await expect(getQueuedSessions(db)).resolves.toEqual([]);

      // A third drain call must not upload it a third time -- it is simply no longer queued.
      const thirdDrain = await drainSyncQueue(db, ACCOUNT_A, failThenSucceed, new Date('2026-09-02T10:00:00.000Z'));
      expect(thirdDrain).toEqual({ uploaded: [], failed: [] });
      expect(attempts).toBe(2);
    });

    it('stops retrying automatically after the max attempt count, without deleting the row', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      const alwaysFail = async (): Promise<void> => {
        throw new Error('permanently broken');
      };

      let now = new Date('2026-09-02T09:00:00.000Z');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await drainSyncQueue(db, ACCOUNT_A, alwaysFail, now);
        now = new Date(now.getTime() + 31 * 60_000);
      }

      const rows = await getQueuedSessions(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.attemptCount).toBe(5);

      // A failed row is skipped entirely on the next drain -- no further upload attempt.
      let calls = 0;
      await drainSyncQueue(
        db, ACCOUNT_A,
        async () => {
          calls += 1;
        },
        new Date(now.getTime() + 60 * 60_000),
      );
      expect(calls).toBe(0);
    });

    it('leaves a not-yet-due row queued without attempting it', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      let calls = 0;
      const result = await drainSyncQueue(
        db, ACCOUNT_A,
        async () => {
          calls += 1;
        },
        new Date('2026-09-02T08:59:59.000Z'),
      );

      expect(result).toEqual({ uploaded: [], failed: [] });
      expect(calls).toBe(0);
    });
  });

  describe('non-retriable vs retriable failure classification (C3)', () => {
    it('marks a row failed on the very first attempt when the rejection is a non-retriable 4xx', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      const rejection: UploadRejection = Object.assign(new Error('contract drift'), { status: 422 });
      const result = await drainSyncQueue(
        db, ACCOUNT_A,
        async () => {
          throw rejection;
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );

      expect(result).toEqual({ uploaded: [], failed: ['session-1'] });
      const rows = await getQueuedSessions(db);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.attemptCount).toBe(1);
    });

    it.each([408, 429])(
      'keeps a row pending with backoff when the rejection is retriable status %i',
      async (status) => {
        await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

        const rejection: UploadRejection = Object.assign(new Error('rate limited'), { status });
        await drainSyncQueue(
          db, ACCOUNT_A,
          async () => {
            throw rejection;
          },
          new Date('2026-09-02T09:00:00.000Z'),
        );

        const rows = await getQueuedSessions(db);
        expect(rows[0]?.status).toBe('pending');
        expect(rows[0]?.attemptCount).toBe(1);
      },
    );

    it('keeps a row pending with backoff on a network error with no status', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      await drainSyncQueue(
        db, ACCOUNT_A,
        async () => {
          throw new Error('network request failed');
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );

      const rows = await getQueuedSessions(db);
      expect(rows[0]?.status).toBe('pending');
      expect(rows[0]?.attemptCount).toBe(1);
    });

    it('keeps a row pending with backoff on a 5xx rejection', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      const rejection: UploadRejection = Object.assign(new Error('server error'), { status: 503 });
      await drainSyncQueue(
        db, ACCOUNT_A,
        async () => {
          throw rejection;
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );

      const rows = await getQueuedSessions(db);
      expect(rows[0]?.status).toBe('pending');
      expect(rows[0]?.attemptCount).toBe(1);
    });
  });

  describe('getFailedSessions / retryFailedSession (C3)', () => {
    it('returns only failed rows, with their last error', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-2'), new Date('2026-09-02T09:00:00.000Z'));

      const rejection: UploadRejection = Object.assign(new Error('contract drift'), { status: 422 });
      await drainSyncQueue(
        db, ACCOUNT_A,
        async (payload) => {
          if (payload.id === 'session-1') throw rejection;
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );

      const failed = await getFailedSessions(db, ACCOUNT_A);
      expect(failed.map((row) => row.sessionId)).toEqual(['session-1']);
      expect(failed[0]?.lastError).toBe('contract drift');
    });

    it('resets a failed row to pending with a zero attempt count so the next drain retries it', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));
      const alwaysFail: UploadRejection = Object.assign(new Error('contract drift'), { status: 422 });
      await drainSyncQueue(
        db, ACCOUNT_A,
        async () => {
          throw alwaysFail;
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );
      expect((await getFailedSessions(db, ACCOUNT_A))[0]?.sessionId).toBe('session-1');

      await retryFailedSession(db, ACCOUNT_A, 'session-1', new Date('2026-09-02T10:00:00.000Z'));

      const rows = await getQueuedSessions(db);
      expect(rows[0]?.status).toBe('pending');
      expect(rows[0]?.attemptCount).toBe(0);
      await expect(getFailedSessions(db, ACCOUNT_A)).resolves.toEqual([]);

      let uploadedCount = 0;
      const result = await drainSyncQueue(
        db, ACCOUNT_A,
        async () => {
          uploadedCount += 1;
        },
        new Date('2026-09-02T10:00:00.000Z'),
      );
      expect(result).toEqual({ uploaded: ['session-1'], failed: [] });
      expect(uploadedCount).toBe(1);
    });
  });

  describe('concurrent drains do not lose-update the attempt counter', () => {
    it('produces attempt_count = 2, not 1, when two drains race on the same failing row', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-1'), new Date('2026-09-02T09:00:00.000Z'));

      const now = new Date('2026-09-02T09:00:00.000Z');
      const alwaysFail = async (): Promise<void> => {
        throw new Error('network error');
      };

      // Neither call is awaited before the other starts -- this is what a reconnect firing
      // while an app-foreground drain is already in flight looks like.
      const [first, second] = await Promise.all([
        drainSyncQueue(db, ACCOUNT_A, alwaysFail, now),
        drainSyncQueue(db, ACCOUNT_A, alwaysFail, now),
      ]);

      expect(first.failed.length + second.failed.length).toBeGreaterThan(0);
      const rows = await getQueuedSessions(db);
      expect(rows[0]?.attemptCount).toBe(2);
    });
  });

  describe('schema versioning (R25)', () => {
    it('migrates a version-1 database to the latest version, preserving existing rows', async () => {
      // A database already at version 1 -- the pre-R25 schema shape -- with a real row in it,
      // as if the app had been used before this migration machinery existed.
      const versionOneDb = new FakeSqliteConnection(1);
      versionOneDb.events.push({
        id: 1,
        session_id: 'session-1',
        type: 'workout_finished',
        occurred_at: '2026-09-02T09:00:00.000Z',
        payload: '{}',
      });
      versionOneDb.nextEventId = 2;

      await ensureWorkoutSessionSchema(versionOneDb);

      // 4: this one shared list also carries run-session.ts's RUN_SESSION_MIGRATION step (ADR-049)
      // at 3 -- one database, one PRAGMA user_version, one list, whichever caller runs first -- and
      // v4 stamps the queue and snapshots with the account that created them (review 8.5 S1), and
      // v5 drops the never-used run_points table (G6).
      expect(versionOneDb.userVersion).toBe(5);
      const events = await getSessionEvents(versionOneDb, 'session-1');
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('workout_finished');
    });

    it('is a no-op on a database already at the latest version', async () => {
      const upToDateDb = new FakeSqliteConnection(5);

      await expect(ensureWorkoutSessionSchema(upToDateDb)).resolves.toBeUndefined();

      expect(upToDateDb.userVersion).toBe(5);
      expect(upToDateDb.executed.filter((sql) => sql.includes('DROP'))).toEqual([]);
    });

    it('migrates a version-3 database (before accounts were recorded) to the latest version', async () => {
      const versionThreeDb = new FakeSqliteConnection(3);

      await ensureWorkoutSessionSchema(versionThreeDb);

      expect(versionThreeDb.userVersion).toBe(5);
    });

    it('drops the unused run_points table and its index at version 5, leaving the run snapshot', async () => {
      const versionFourDb = new FakeSqliteConnection(4);

      await ensureWorkoutSessionSchema(versionFourDb);

      expect(versionFourDb.userVersion).toBe(5);
      const drops = versionFourDb.executed.filter((sql) => sql.includes('DROP'));
      expect(drops.join('\n')).toMatch(/DROP INDEX IF EXISTS idx_run_points_session_id/);
      expect(drops.join('\n')).toMatch(/DROP TABLE IF EXISTS run_points/);
      expect(drops.join('\n')).not.toMatch(/run_snapshot/);
    });
  });

  describe('account scoping (whole-app review 8.5, L3-1)', () => {
    it("never uploads another account's queued session: a session finished by A waits for A", async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-a'), new Date('2026-09-02T09:00:00.000Z'));
      await enqueueSessionUpload(db, ACCOUNT_B, uploadRequest('session-b'), new Date('2026-09-02T09:00:00.000Z'));

      const uploadedByB: string[] = [];
      const result = await drainSyncQueue(
        db,
        ACCOUNT_B,
        async (body) => {
          uploadedByB.push(body.id);
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );

      expect(result).toEqual({ uploaded: ['session-b'], failed: [] });
      expect(uploadedByB).toEqual(['session-b']);
      // A's session is untouched, still queued for when A signs back in.
      const remaining = await getQueuedSessions(db);
      expect(remaining.map((row) => [row.sessionId, row.accountId])).toEqual([['session-a', ACCOUNT_A]]);

      const uploadedByA: string[] = [];
      await drainSyncQueue(
        db,
        ACCOUNT_A,
        async (body) => {
          uploadedByA.push(body.id);
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );
      expect(uploadedByA).toEqual(['session-a']);
    });

    it('uploads nothing when nobody is signed in', async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-a'), new Date('2026-09-02T09:00:00.000Z'));

      let calls = 0;
      const result = await drainSyncQueue(
        db,
        null,
        async () => {
          calls += 1;
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );

      expect(result).toEqual({ uploaded: [], failed: [] });
      expect(calls).toBe(0);
    });

    it('lets the signed-in account claim a row queued before accounts were recorded', async () => {
      await enqueueSessionUpload(db, null, uploadRequest('legacy'), new Date('2026-09-02T09:00:00.000Z'));

      const result = await drainSyncQueue(db, ACCOUNT_A, async () => undefined, new Date('2026-09-02T09:00:00.000Z'));

      expect(result.uploaded).toEqual(['legacy']);
    });

    it("lists only the signed-in account's failed sessions for the retry banner", async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-a'), new Date('2026-09-02T09:00:00.000Z'));
      await enqueueSessionUpload(db, ACCOUNT_B, uploadRequest('session-b'), new Date('2026-09-02T09:00:00.000Z'));
      const rejection: UploadRejection = Object.assign(new Error('contract drift'), { status: 422 });
      const reject = async (): Promise<void> => {
        throw rejection;
      };
      await drainSyncQueue(db, ACCOUNT_A, reject, new Date('2026-09-02T09:00:00.000Z'));
      await drainSyncQueue(db, ACCOUNT_B, reject, new Date('2026-09-02T09:00:00.000Z'));

      await expect(getFailedSessions(db, ACCOUNT_B)).resolves.toEqual([
        expect.objectContaining({ sessionId: 'session-b' }),
      ]);
      await expect(getFailedSessions(db, null)).resolves.toEqual([]);
    });

    it("will not retry another account's failed session", async () => {
      await enqueueSessionUpload(db, ACCOUNT_A, uploadRequest('session-a'), new Date('2026-09-02T09:00:00.000Z'));
      const rejection: UploadRejection = Object.assign(new Error('contract drift'), { status: 422 });
      await drainSyncQueue(
        db,
        ACCOUNT_A,
        async () => {
          throw rejection;
        },
        new Date('2026-09-02T09:00:00.000Z'),
      );

      await retryFailedSession(db, ACCOUNT_B, 'session-a', new Date('2026-09-02T10:00:00.000Z'));

      await expect(getFailedSessions(db, ACCOUNT_A)).resolves.toEqual([
        expect.objectContaining({ sessionId: 'session-a' }),
      ]);
    });

    it("offers crash recovery only for the signed-in account's unfinished session", async () => {
      await saveSessionSnapshot(db, ACCOUNT_A, 'session-a', { name: 'A' }, '2026-09-02T09:00:00.000Z');

      await expect(getUnfinishedSessionSnapshot(db, ACCOUNT_B)).resolves.toBeNull();
      await expect(getUnfinishedSessionSnapshot(db, null)).resolves.toBeNull();
      await expect(getUnfinishedSessionSnapshot(db, ACCOUNT_A)).resolves.toEqual({
        sessionId: 'session-a',
        payload: { name: 'A' },
        startedAt: '2026-09-02T09:00:00.000Z',
      });
    });

    it('offers a snapshot saved before accounts were recorded to whoever is signed in', async () => {
      await saveSessionSnapshot(db, null, 'legacy', { name: 'Old' }, '2026-09-02T09:00:00.000Z');

      await expect(getUnfinishedSessionSnapshot(db, ACCOUNT_B)).resolves.toEqual(
        expect.objectContaining({ sessionId: 'legacy' }),
      );
    });

    it('throws rather than silently proceeding when the database is newer than this app build understands', async () => {
      // Simulates a newer build of the app (or a future migration) having already run against
      // this database -- opening it with older code must fail loudly, not corrupt data.
      const newerDb = new FakeSqliteConnection(99);

      await expect(ensureWorkoutSessionSchema(newerDb)).rejects.toThrow(/version 99/);

      // And it must not have silently bumped the version down or mutated it.
      expect(newerDb.userVersion).toBe(99);
    });
  });
});
