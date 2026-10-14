import type { SqliteConnection } from './exercise-catalogue';
import type { SqliteMigration } from './sqlite-migrations';

/**
 * The phone's memory of last time's sets per exercise (docs/product/live-prev-column-plan.md), so the live workout's
 * PREV column and its start-filled sets work without signal (rule 6). One row per account and exercise: when that
 * workout was performed and its completed sets as JSON. It lives in the workout-log database
 * (`forjd-workout-sessions.db`), whose file is deleted with the account (`local-data.ts`).
 *
 * The same shape as `PreviousSet` in `workouts/previous-sets.ts`, declared here so the store does not import the
 * workout engine.
 */
export interface StoredPreviousSet {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface StoredPrevious {
  performedAt: string;
  sets: StoredPreviousSet[];
}

/**
 * This table's step in the **one shared migration list** `workout-session.ts` owns (see its `MIGRATIONS` docblock):
 * exported so this file stays where the table is defined, and appended there unchanged, like `RUN_SESSION_MIGRATION`.
 */
export const PREVIOUS_SETS_MIGRATION: SqliteMigration = {
  version: 6,
  async up(db) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS previous_sets (
        account_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        performed_at TEXT NOT NULL,
        sets TEXT NOT NULL,
        PRIMARY KEY (account_id, exercise_id)
      );
    `);
  },
};

const isNumberOrNull = (value: unknown): value is number | null => value === null || typeof value === 'number';

function parseSets(raw: string): StoredPreviousSet[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const sets: StoredPreviousSet[] = [];
    for (const item of parsed) {
      const set = item as Record<string, unknown>;
      if (
        !isNumberOrNull(set.weightKg) ||
        !isNumberOrNull(set.reps) ||
        !isNumberOrNull(set.durationSeconds) ||
        !isNumberOrNull(set.distanceMeters)
      ) {
        return null;
      }
      sets.push({
        weightKg: set.weightKg,
        reps: set.reps,
        durationSeconds: set.durationSeconds,
        distanceMeters: set.distanceMeters,
      });
    }
    return sets;
  } catch {
    return null;
  }
}

/** Last time's sets for this account and exercise, or `null` (none kept, no account, or a damaged row). */
export async function readPreviousSets(
  db: SqliteConnection,
  accountId: string | null,
  exerciseId: string,
): Promise<StoredPrevious | null> {
  if (!accountId) return null;
  const rows = await db.getAllAsync<{ performed_at: string; sets: string }>(
    'SELECT performed_at, sets FROM previous_sets WHERE account_id = ? AND exercise_id = ?',
    [accountId, exerciseId],
  );
  const row = rows[0];
  if (!row) return null;
  const sets = parseSets(row.sets);
  return sets ? { performedAt: row.performed_at, sets } : null;
}

/**
 * Keeps these sets as last time's, unless a newer workout is already kept (a slow server answer must not replace
 * the workout just finished). Without an account nothing is kept: the row would belong to no one.
 */
export async function rememberPreviousSets(
  db: SqliteConnection,
  accountId: string | null,
  exerciseId: string,
  performedAt: string,
  sets: readonly StoredPreviousSet[],
): Promise<void> {
  if (!accountId || sets.length === 0) return;
  const kept = await readPreviousSets(db, accountId, exerciseId);
  if (kept && new Date(kept.performedAt).getTime() >= new Date(performedAt).getTime()) return;
  await db.runAsync(
    'INSERT OR REPLACE INTO previous_sets (account_id, exercise_id, performed_at, sets) VALUES (?, ?, ?, ?)',
    [accountId, exerciseId, performedAt, JSON.stringify(sets)],
  );
}
