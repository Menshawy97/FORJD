import * as SQLite from 'expo-sqlite';
import type { SQLiteBindValue } from 'expo-sqlite';

import type { ExerciseCatalogueResponse, ExerciseResponse } from '@forjd/contracts';

/**
 * The on-device exercise library (Phase H). `expo-sqlite` behind a function seam, the way
 * `notification-preferences.ts` wraps AsyncStorage: screens never touch SQLite directly, and
 * `scripts/ci/check-architecture-conformance.sh` pins the `expo-sqlite` import to this one
 * file, the same pattern already enforced for `expo-secure-store` (rule 3 of that check,
 * ADR-011's precedent).
 *
 * **Why SQLite here and not AsyncStorage.** ~1,700+ full exercise records is the "a table
 * holding something relational" case `notification-preferences.ts`'s own comment carves out
 * as SQLite's, not AsyncStorage's -- and offline workout execution (CLAUDE.md rule 6, the
 * network is never in the critical path of a live session) needs the whole catalogue on the
 * device, searchable, without a round trip.
 *
 * **Every function here takes a connection as its first argument.** `expo-sqlite`'s native
 * module cannot run under plain Jest, so the connection is injected -- same fix, same reason,
 * as `SupabaseStorageProvider` taking its client by injection (ADR-011): the alternative is a
 * module that opens its own database in its own top-level code and is then unverifiable
 * except by hand on a device. `openExerciseCatalogueDb()` is the one function that touches
 * the real `expo-sqlite` API; everything else is exercised in `exercise-catalogue.test.ts`
 * against a fake implementing the same minimal interface.
 */

/** The slice of `expo-sqlite`'s `SQLiteDatabase` this module actually uses. */
export interface SqliteConnection {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SQLiteBindValue[]): Promise<unknown>;
  getAllAsync<T>(source: string, params: SQLiteBindValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

const DATABASE_NAME = 'forjd-exercise-catalogue.db';
const VERSION_KEY = 'catalogueVersion';

/** The only call in this module that reaches the real native module. */
export async function openExerciseCatalogueDb(): Promise<SqliteConnection> {
  return SQLite.openDatabaseAsync(DATABASE_NAME);
}

/**
 * Idempotent, run before every use rather than once at app startup -- cheap (`IF NOT EXISTS`
 * on every statement) and it means a test or a caller never has to remember an init step
 * happened first.
 *
 * `exercises_cache.data` holds the full `ExerciseResponse` JSON, minus `isFavourite` --
 * deliberately not baked into the blob, because favourite state is written far more often
 * than catalogue content (`setLocalFavourite` below) and keeping it in its own column is what
 * makes that a single-row `UPDATE` instead of a JSON re-encode. `exercises_fts` is FTS5: the
 * searchable text is duplicated into the index by design, but the row it belongs to is always
 * fetched from `exercises_cache` by id, never from the FTS table itself, so there is exactly
 * one place a row's real content lives.
 */
/**
 * One `execAsync` call per statement, not one call carrying all three separated by `;`.
 * Split while investigating a `NativeDatabase.execAsync` -> `NullPointerException` seen on
 * the Android **emulator** (API 34, x86_64) — the split alone did not resolve it, so the
 * cause is not multi-statement parsing. Kept anyway: it is a strictly simpler call shape and
 * makes a future native-side investigation easier to pinpoint (each statement fails or
 * succeeds independently). See the same investigation's note in ADR-022 for what is and
 * isn't confirmed about where this reproduces.
 */
export async function ensureExerciseCatalogueSchema(db: SqliteConnection): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS exercises_cache (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      is_custom INTEGER NOT NULL,
      is_favourite INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    );
  `);
  await db.execAsync(`
    CREATE VIRTUAL TABLE IF NOT EXISTS exercises_fts USING fts5(
      id UNINDEXED,
      name,
      muscles,
      equipment
    );
  `);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS catalogue_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export async function getStoredCatalogueVersion(db: SqliteConnection): Promise<string | null> {
  const rows = await db.getAllAsync<{ value: string }>(
    'SELECT value FROM catalogue_meta WHERE key = ?',
    [VERSION_KEY],
  );
  return rows[0]?.value ?? null;
}

/** Strips `isFavourite` before storing -- see the schema comment on why it lives in its own column. */
function serializeWithoutFavourite(exercise: ExerciseResponse): string {
  const rest: Partial<ExerciseResponse> = { ...exercise };
  delete rest.isFavourite;
  return JSON.stringify(rest);
}

function rowToExercise(row: { data: string; is_favourite: number }): ExerciseResponse {
  return { ...(JSON.parse(row.data) as Omit<ExerciseResponse, 'isFavourite'>), isFavourite: row.is_favourite === 1 };
}

/**
 * Version-gated: fetches the remote catalogue unconditionally (every launch still makes the
 * network call), but only pays for the SQLite rebuild and FTS5 reindex -- the expensive part
 * -- when `catalogueVersion` actually differs from what is already stored. Matches
 * `ExercisesService.getCatalogue`'s own contract: the version deliberately ignores favourite
 * status, so a favourite toggle alone never triggers a rebuild here either.
 *
 * The rebuild is a full replace inside one transaction, not a diff -- there is no id-level
 * change feed from the server to diff against, and at ~1,700 rows a full rewrite is cheap
 * enough that building one would cost more than it saves.
 */
export async function syncExerciseCatalogue(
  db: SqliteConnection,
  fetchCatalogue: () => Promise<ExerciseCatalogueResponse>,
): Promise<{ synced: boolean; count: number }> {
  await ensureExerciseCatalogueSchema(db);

  const remote = await fetchCatalogue();
  const storedVersion = await getStoredCatalogueVersion(db);

  if (storedVersion === remote.catalogueVersion) {
    return { synced: false, count: remote.exercises.length };
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM exercises_cache', []);
    await db.runAsync('DELETE FROM exercises_fts', []);

    for (const exercise of remote.exercises) {
      await db.runAsync(
        'INSERT INTO exercises_cache (id, name, category, is_custom, is_favourite, data) VALUES (?, ?, ?, ?, ?, ?)',
        [
          exercise.id,
          exercise.name,
          exercise.category,
          exercise.isCustom ? 1 : 0,
          exercise.isFavourite ? 1 : 0,
          serializeWithoutFavourite(exercise),
        ],
      );
      await db.runAsync('INSERT INTO exercises_fts (id, name, muscles, equipment) VALUES (?, ?, ?, ?)', [
        exercise.id,
        exercise.name,
        [...exercise.primaryMuscles, ...exercise.secondaryMuscles].join(' '),
        exercise.equipment.join(' '),
      ]);
    }

    await db.runAsync('INSERT OR REPLACE INTO catalogue_meta (key, value) VALUES (?, ?)', [
      VERSION_KEY,
      remote.catalogueVersion,
    ]);
  });

  return { synced: true, count: remote.exercises.length };
}

/**
 * `MATCH` against FTS5, joined back to `exercises_cache` for the real row -- the FTS table
 * itself is contentless (see the schema comment) and has nothing to return but an id.
 * `*` suffix makes every term a prefix match, so "bench" finds "Bench Press" without the
 * caller needing to know FTS5 query syntax.
 */
export async function searchExercises(db: SqliteConnection, query: string): Promise<ExerciseResponse[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const matchQuery = trimmed
    .split(/\s+/)
    .map((term) => `${term.replace(/"/g, '""')}*`)
    .join(' ');

  const rows = await db.getAllAsync<{ data: string; is_favourite: number }>(
    `SELECT c.data as data, c.is_favourite as is_favourite
     FROM exercises_fts f
     JOIN exercises_cache c ON c.id = f.id
     WHERE exercises_fts MATCH ?
     ORDER BY c.name`,
    [matchQuery],
  );

  return rows.map(rowToExercise);
}

export interface CachedExerciseFilter {
  category?: string;
  favouritesOnly?: boolean;
}

/**
 * The browse-time read behind the library screen's chips (Phase I) -- plain `WHERE` clauses
 * over `exercises_cache`'s own columns, not FTS5. `category`/`favouritesOnly` are not text
 * queries, so routing them through FTS5 would mean either a second, redundant column set in
 * the index or a JOIN that FTS5 buys nothing for. `searchExercises` stays the text-search
 * path; this is the "show me everything matching these filters" path, ordered the same way
 * (`name`) so the two feel like one continuous list to a screen that combines both.
 */
export async function listCachedExercises(
  db: SqliteConnection,
  filter: CachedExerciseFilter = {},
): Promise<ExerciseResponse[]> {
  const conditions: string[] = [];
  const params: SQLiteBindValue[] = [];

  if (filter.category) {
    conditions.push('category = ?');
    params.push(filter.category);
  }
  if (filter.favouritesOnly) {
    conditions.push('is_favourite = 1');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.getAllAsync<{ data: string; is_favourite: number }>(
    `SELECT data, is_favourite FROM exercises_cache ${where} ORDER BY name`,
    params,
  );

  return rows.map(rowToExercise);
}

export async function getCachedExercise(db: SqliteConnection, id: string): Promise<ExerciseResponse | null> {
  const rows = await db.getAllAsync<{ data: string; is_favourite: number }>(
    'SELECT data, is_favourite FROM exercises_cache WHERE id = ?',
    [id],
  );
  const [row] = rows;
  return row ? rowToExercise(row) : null;
}

/**
 * Removes one row from the local mirror immediately, called after `DELETE /exercises/:id`
 * succeeds against the API -- the same "write the API result into the mirror right away,
 * independent of the next version-gated sync" idea `setLocalFavourite` already applies, so a
 * deleted custom exercise disappears from the library instantly rather than waiting for the
 * next `syncExerciseCatalogue` to notice the server's `catalogueVersion` changed.
 */
export async function removeCachedExercise(db: SqliteConnection, id: string): Promise<void> {
  await db.runAsync('DELETE FROM exercises_cache WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM exercises_fts WHERE id = ?', [id]);
}

/**
 * Writes a favourite toggle into the local mirror immediately, independent of the next
 * version-gated sync -- called after `PUT`/`DELETE /exercises/:id/favourite` succeeds against
 * the API, not instead of it. This is the other half of `getCatalogue`'s documented design:
 * the version hash ignores favourite status specifically so this stays a one-row update
 * rather than forcing a full re-sync on every star tap.
 */
export async function setLocalFavourite(db: SqliteConnection, id: string, isFavourite: boolean): Promise<void> {
  await db.runAsync('UPDATE exercises_cache SET is_favourite = ? WHERE id = ?', [isFavourite ? 1 : 0, id]);
}
