import * as SQLite from 'expo-sqlite';

import type { WorkoutEventType, WorkoutSessionStatus } from '@forjd/domain';
import type { WorkoutSessionUploadRequest } from '@forjd/contracts';

import type { SqliteConnection } from './exercise-catalogue';

/**
 * The offline layer for a live workout session (Phase 3F, ADR-025). `expo-sqlite` behind the
 * same injected-`SqliteConnection` seam ADR-022 established for the exercise catalogue --
 * reused here, not redeclared, because it is already the exact "slice of `expo-sqlite`'s
 * `SQLiteDatabase` this module actually uses" shape. `scripts/ci/check-architecture-conformance.sh`
 * pins `expo-sqlite` itself to this file and `exercise-catalogue.ts` only.
 *
 * Two independent tables, matching the two things this file does:
 *
 * - **`session_events`** -- the append-only log `docs/architecture/workout-engine.md`
 *   specifies. What makes crash recovery real: a force-killed app rebuilds its session state
 *   by replaying this log (`replaySessionState`), not by trusting whatever React state
 *   happened to survive.
 * - **`session_queue`** -- one row per *finished* session awaiting upload, written by
 *   `enqueueSessionUpload`. **The caller does this, not `appendSessionEvent`.** An earlier
 *   version of this docblock claimed a session was enqueued automatically when a
 *   `workout_finished` event was appended; it never was, and the live screen's Finish handler
 *   is the one place it happens (Phase I).
 *
 * See ADR-025 for the full retry/backoff and deleted-exercise-reference decisions this file
 * implements.
 */

const DATABASE_NAME = 'forjd-workout-sessions.db';

/** The only call in this module that reaches the real native module -- see ADR-022's own precedent for why that line is left for a device walk, not Jest, to prove. */
export async function openWorkoutSessionDb(): Promise<SqliteConnection> {
  return SQLite.openDatabaseAsync(DATABASE_NAME);
}

/** Idempotent, run before every use -- see `exercise-catalogue.ts`'s own note on why (`IF NOT EXISTS` on every statement, cheap, no init step for a caller to forget). */
export async function ensureWorkoutSessionSchema(db: SqliteConnection): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  // What the event log alone cannot rebuild. Replaying `session_events` restores *what happened*
  // -- which sets were ticked, when the athlete paused -- but not *what the session is*: its
  // name, its exercises, or the targets prescribed for each set. Without this row, a
  // force-killed app has a log it cannot interpret. One row per unfinished session; dropped
  // when the session finishes and is handed to the queue.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS session_snapshot (
      session_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
  `);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS session_queue (
      session_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT NOT NULL,
      last_error TEXT
    );
  `);
}

/**
 * One entry in the local event log. `id` is this table's own autoincrement rowid, not
 * `@forjd/domain`'s `WorkoutSessionEvent.id` (a string) -- this row is purely local, never
 * sent to the server as-is (the server receives the *rebuilt* session, per that domain
 * interface's own docblock), so there is no reason to force the two ids into one shape.
 */
export interface SessionEventRecord {
  id: number;
  sessionId: string;
  type: WorkoutEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
}

function rowToEvent(row: {
  id: number;
  session_id: string;
  type: string;
  occurred_at: string;
  payload: string;
}): SessionEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type as WorkoutEventType,
    occurredAt: row.occurred_at,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  };
}

/**
 * Appends one event to the log -- the only write path a live session takes while it is
 * running. Autoincrement order is replay order: this is a single-writer, single-device
 * store, so there is no separate sequence column to keep in step, and no wall-clock sort
 * that a device's clock change could disturb.
 */
export async function appendSessionEvent(
  db: SqliteConnection,
  sessionId: string,
  type: WorkoutEventType,
  occurredAt: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO session_events (session_id, type, occurred_at, payload) VALUES (?, ?, ?, ?)',
    [sessionId, type, occurredAt, JSON.stringify(payload)],
  );
}

export async function getSessionEvents(db: SqliteConnection, sessionId: string): Promise<SessionEventRecord[]> {
  const rows = await db.getAllAsync<{
    id: number;
    session_id: string;
    type: string;
    occurred_at: string;
    payload: string;
  }>('SELECT id, session_id, type, occurred_at, payload FROM session_events WHERE session_id = ? ORDER BY id', [
    sessionId,
  ]);
  return rows.map(rowToEvent);
}

/** Called once a session's queue row has successfully uploaded -- the log has done its job (crash recovery for a session that no longer needs recovering) and is dropped with it. */
export async function clearSessionEvents(db: SqliteConnection, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM session_events WHERE session_id = ?', [sessionId]);
}

/** One unfinished session, as written at start and read back after a crash. */
export interface SessionSnapshotRecord {
  sessionId: string;
  /** The started session, opaque here -- `live-session.ts` owns its shape. */
  payload: Record<string, unknown>;
  startedAt: string;
}

/**
 * Records a session so a force-killed app can rebuild it.
 *
 * Written **once, at session start**, not on every change: the mutable part of a session is
 * exactly what the event log already carries, and rewriting this row per tick would reintroduce
 * the "mutable current-session row" the append-only design exists to avoid.
 *
 * `INSERT OR REPLACE` so starting a session twice with the same id (a remount) overwrites
 * rather than throwing.
 */
export async function saveSessionSnapshot(
  db: SqliteConnection,
  sessionId: string,
  payload: Record<string, unknown>,
  startedAt: string,
): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO session_snapshot (session_id, payload, started_at) VALUES (?, ?, ?)', [
    sessionId,
    JSON.stringify(payload),
    startedAt,
  ]);
}

/**
 * The session to offer to resume, or `null`.
 *
 * Returns the **most recently started** one. There should only ever be a single row -- a
 * session is snapshotted at start and cleared when it finishes -- but ordering makes the
 * behaviour defined rather than incidental if an earlier session was abandoned without ever
 * being finished (an app killed at exactly the wrong moment, say).
 */
export async function getUnfinishedSessionSnapshot(db: SqliteConnection): Promise<SessionSnapshotRecord | null> {
  const rows = await db.getAllAsync<{ session_id: string; payload: string; started_at: string }>(
    'SELECT session_id, payload, started_at FROM session_snapshot ORDER BY started_at DESC LIMIT 1',
    [],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    startedAt: row.started_at,
  };
}

/**
 * Drops a snapshot. Called when a session finishes, and when the athlete declines to resume --
 * in the second case the events go too, since a session nobody intends to continue should not
 * keep being offered, nor grow the log forever.
 */
export async function clearSessionSnapshot(db: SqliteConnection, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM session_snapshot WHERE session_id = ?', [sessionId]);
}

/**
 * The rebuilt state of a session from its event log -- what a force-killed app reconstructs
 * on reopen. `startedAt` is a parameter, not inferred from the log's first entry: there is no
 * `workout_started` event in `WORKOUT_EVENT_TYPES` (session start is the moment the session
 * row itself is created, before any event exists), so a log whose very first entry happened
 * to be a pause would otherwise compute a nonsensical zero-length pre-pause window.
 *
 * `durationSeconds` excludes every `workout_paused` -> `workout_resumed` interval, matching
 * `WorkoutSession.durationSeconds`'s own domain contract ("excluding paused stretches...not
 * simply `endedAt - startedAt`"). `rest_started`/`rest_completed`/`exercise_completed` do not
 * affect status or duration bookkeeping here -- a rest period is a logged fact the live
 * screen's rest timer reads (a future phase), not a pause the user explicitly asked for.
 */
export interface ReplayedSessionState {
  status: WorkoutSessionStatus;
  durationSeconds: number;
  /** `${exerciseId}:${setIndex}` for every set a `set_completed` event marked done. */
  completedSetKeys: string[];
}

export function replaySessionState(startedAt: Date, events: SessionEventRecord[]): ReplayedSessionState {
  let status: WorkoutSessionStatus = 'in_progress';
  let pausedAt: Date | null = null;
  let totalPausedMs = 0;
  const completedSetKeys = new Set<string>();
  let lastEventAt = startedAt;

  for (const event of events) {
    const occurredAt = new Date(event.occurredAt);
    lastEventAt = occurredAt;

    switch (event.type) {
      case 'set_completed': {
        const { exerciseId, setIndex } = event.payload as { exerciseId: string; setIndex: number };
        completedSetKeys.add(`${exerciseId}:${setIndex}`);
        break;
      }
      // The log is append-only, so unticking a set is recorded as its own event rather than by
      // removing the `set_completed` one. Replay order therefore matters: a set ticked, then
      // unticked, then ticked again must end up completed, which falls out of applying each
      // event in `id` order rather than counting them.
      case 'set_uncompleted': {
        const { exerciseId, setIndex } = event.payload as { exerciseId: string; setIndex: number };
        completedSetKeys.delete(`${exerciseId}:${setIndex}`);
        break;
      }
      case 'workout_paused':
        status = 'paused';
        pausedAt = occurredAt;
        break;
      case 'workout_resumed':
        if (pausedAt) {
          totalPausedMs += occurredAt.getTime() - pausedAt.getTime();
          pausedAt = null;
        }
        status = 'in_progress';
        break;
      case 'workout_finished':
        status = 'completed';
        break;
      default:
        // rest_started / rest_completed / exercise_completed: logged detail, no state change here.
        break;
    }
  }

  const endBoundary = status === 'paused' && pausedAt ? pausedAt : lastEventAt;
  const elapsedMs = endBoundary.getTime() - startedAt.getTime() - totalPausedMs;

  return {
    status,
    durationSeconds: Math.max(0, Math.round(elapsedMs / 1000)),
    completedSetKeys: [...completedSetKeys],
  };
}

/** Backoff schedule -- 1s, 2s, 4s, ... capped at 30 minutes. See ADR-025. */
function backoffMs(attemptCount: number): number {
  return Math.min(30 * 60_000, 1_000 * 2 ** attemptCount);
}

/** After this many failed attempts, a row stops being retried automatically -- see ADR-025. */
const MAX_ATTEMPTS = 5;

export type SessionQueueStatus = 'pending' | 'failed';

export interface QueuedSessionRow {
  sessionId: string;
  payload: WorkoutSessionUploadRequest;
  status: SessionQueueStatus;
  attemptCount: number;
  nextRetryAt: string;
  lastError: string | null;
}

function rowToQueueEntry(row: {
  session_id: string;
  payload: string;
  status: string;
  attempt_count: number;
  next_retry_at: string;
  last_error: string | null;
}): QueuedSessionRow {
  return {
    sessionId: row.session_id,
    payload: JSON.parse(row.payload) as WorkoutSessionUploadRequest,
    status: row.status as SessionQueueStatus,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
  };
}

/**
 * Enqueues a finished session for upload. `INSERT OR REPLACE` by `payload.id` (the session's
 * own client-generated idempotency key): re-finishing the same session id resets its retry
 * state to a fresh attempt rather than accumulating against whatever attempt count an
 * earlier, unrelated failure left behind -- there is exactly one code path that calls this,
 * the one observing `workout_finished`, so a second call for the same id only happens if the
 * caller itself is retried before the first enqueue's transaction lands.
 */
export async function enqueueSessionUpload(
  db: SqliteConnection,
  payload: WorkoutSessionUploadRequest,
  now: Date = new Date(),
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO session_queue (session_id, payload, status, attempt_count, next_retry_at, last_error)
     VALUES (?, ?, 'pending', 0, ?, NULL)`,
    [payload.id, JSON.stringify(payload), now.toISOString()],
  );
}

export async function getQueuedSessions(db: SqliteConnection): Promise<QueuedSessionRow[]> {
  const rows = await db.getAllAsync<{
    session_id: string;
    payload: string;
    status: string;
    attempt_count: number;
    next_retry_at: string;
    last_error: string | null;
  }>(
    'SELECT session_id, payload, status, attempt_count, next_retry_at, last_error FROM session_queue ORDER BY session_id',
    [],
  );
  return rows.map(rowToQueueEntry);
}

/**
 * Drains every due row in the queue through `uploadSession`, injected the same way
 * `syncExerciseCatalogue` injects `fetchCatalogue` -- this module never imports the API
 * client directly, so it stays testable against a fake that can simulate a rejected upload
 * with no real HTTP call or running server.
 *
 * Safe to call on every reconnect or app-foreground event: a row whose `next_retry_at` has
 * not passed, or whose `status` is already `failed`, is skipped without an upload attempt.
 * A row that succeeds is removed together with its event log (`clearSessionEvents`) so it can
 * never be uploaded a second time by a later drain call -- idempotency at the HTTP layer
 * (Phase E) is the second line of defence, not the only one.
 */
export async function drainSyncQueue(
  db: SqliteConnection,
  uploadSession: (payload: WorkoutSessionUploadRequest) => Promise<void>,
  now: Date = new Date(),
): Promise<{ uploaded: string[]; failed: string[] }> {
  const rows = await getQueuedSessions(db);
  const uploaded: string[] = [];
  const failed: string[] = [];

  for (const row of rows) {
    if (row.status === 'failed') {
      continue;
    }
    if (new Date(row.nextRetryAt) > now) {
      continue;
    }

    try {
      await uploadSession(row.payload);
      await db.runAsync('DELETE FROM session_queue WHERE session_id = ?', [row.sessionId]);
      await clearSessionEvents(db, row.sessionId);
      uploaded.push(row.sessionId);
    } catch (error) {
      const attemptCount = row.attemptCount + 1;
      const status: SessionQueueStatus = attemptCount >= MAX_ATTEMPTS ? 'failed' : 'pending';
      const nextRetryAt = new Date(now.getTime() + backoffMs(attemptCount)).toISOString();
      const message = error instanceof Error ? error.message : String(error);

      await db.runAsync(
        'UPDATE session_queue SET attempt_count = ?, status = ?, next_retry_at = ?, last_error = ? WHERE session_id = ?',
        [attemptCount, status, nextRetryAt, message, row.sessionId],
      );
      failed.push(row.sessionId);
    }
  }

  return { uploaded, failed };
}
