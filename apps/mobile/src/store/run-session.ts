import type { SQLiteBindValue } from 'expo-sqlite';

import { runSqliteMigrations, type SqliteMigration } from './sqlite-migrations';
import type { SqliteConnection } from './exercise-catalogue';

/**
 * Crash recovery for a run in progress (ADR-049), the run counterpart of `workout-session.ts`'s
 * `session_snapshot`. Two tables in the same on-device database the strength runner already opens
 * (`openWorkoutSessionDb`), migrated forward with the same version-tracked mechanism, so a run and
 * a strength session share one database file rather than two.
 *
 * **`run_points` holds the route, and it never leaves the phone.** It exists only so a
 * force-killed app can rebuild the map and the distance already covered; it is read only by
 * `live-run.ts`'s reducer replaying its own points on reopen, never uploaded (ADR-049 #4). It is
 * cleared with the run, exactly as `session_events` is for a strength session.
 *
 * **`run_snapshot` holds the run's own start facts** -- id, started-at, and the small options
 * `toRunUploadRequest` needs (weight, consent) that do not change mid-run -- the same "write once
 * at start" reasoning `saveSessionSnapshot`'s own docblock gives, and for the same reason: rewriting
 * it every tick would reintroduce the mutable-row problem the append-only points table avoids.
 */
const MIGRATIONS: SqliteMigration[] = [
  {
    version: 3,
    async up(db) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS run_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          payload TEXT NOT NULL
        );
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_run_points_session_id ON run_points(session_id);
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS run_snapshot (
          session_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          started_at TEXT NOT NULL
        );
      `);
    },
  },
];

/** Idempotent, run before every use -- see `exercise-catalogue.ts`'s own note on why. */
export async function ensureRunSessionSchema(db: SqliteConnection): Promise<void> {
  await runSqliteMigrations(db, MIGRATIONS);
}

/** One GPS reading, in the shape `live-run.ts` records it -- opaque here, like the session log's payload. */
export interface RunPointRecord {
  latitude: number;
  longitude: number;
  movingMs: number;
  [key: string]: SQLiteBindValue | undefined;
}

/** Appends one reading to a run's route. */
export async function appendRunPoint(db: SqliteConnection, sessionId: string, point: RunPointRecord): Promise<void> {
  await db.runAsync('INSERT INTO run_points (session_id, payload) VALUES (?, ?)', [
    sessionId,
    JSON.stringify(point),
  ]);
}

/** A run's route so far, oldest first. */
export async function getRunPoints(db: SqliteConnection, sessionId: string): Promise<RunPointRecord[]> {
  const rows = await db.getAllAsync<{ payload: string }>(
    'SELECT payload FROM run_points WHERE session_id = ? ORDER BY id ASC',
    [sessionId],
  );
  return rows.map((row) => JSON.parse(row.payload) as RunPointRecord);
}

/** Drops a run's route. Called when the run finishes or is discarded. */
export async function clearRunPoints(db: SqliteConnection, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM run_points WHERE session_id = ?', [sessionId]);
}

export interface RunSnapshotRecord {
  sessionId: string;
  payload: Record<string, unknown>;
  startedAt: string;
}

/** Records a run so a force-killed app can offer to resume it. Written once, at start. */
export async function saveRunSnapshot(
  db: SqliteConnection,
  sessionId: string,
  payload: Record<string, unknown>,
  startedAt: string,
): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO run_snapshot (session_id, payload, started_at) VALUES (?, ?, ?)', [
    sessionId,
    JSON.stringify(payload),
    startedAt,
  ]);
}

/** The run to offer to resume, or `null`. The most recently started one, as `getUnfinishedSessionSnapshot` does. */
export async function getUnfinishedRunSnapshot(db: SqliteConnection): Promise<RunSnapshotRecord | null> {
  const rows = await db.getAllAsync<{ session_id: string; payload: string; started_at: string }>(
    'SELECT session_id, payload, started_at FROM run_snapshot ORDER BY started_at DESC LIMIT 1',
    [],
  );
  const row = rows[0];
  if (!row) return null;
  return { sessionId: row.session_id, payload: JSON.parse(row.payload) as Record<string, unknown>, startedAt: row.started_at };
}

/** Drops a run's snapshot. Called when it finishes or is discarded. */
export async function clearRunSnapshot(db: SqliteConnection, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM run_snapshot WHERE session_id = ?', [sessionId]);
}
