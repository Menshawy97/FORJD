import type { SqliteConnection } from './exercise-catalogue';

/**
 * One ordered schema-migration step, shared by `workout-session.ts` and
 * `exercise-catalogue.ts` (R25, `docs/product/audit-remediation-plan.md`). `version` is the
 * `PRAGMA user_version` value this step upgrades the database *to*, not an array index --
 * `runSqliteMigrations` sorts by it rather than trusting call-site order.
 */
export interface SqliteMigration {
  version: number;
  up(db: SqliteConnection): Promise<void>;
}

/**
 * Runs every migration a database is currently missing, tracked by SQLite's own built-in
 * `PRAGMA user_version` counter -- no extra table to create or keep in sync.
 *
 * `CREATE TABLE IF NOT EXISTS` alone (the pre-R25 shape of both stores) cannot express "add a
 * column" or "add an index" safely: run twice, it is silently a no-op against an
 * already-created table, so a fresh install and an upgraded device's existing database would
 * silently diverge in schema the moment a migration changed anything but a brand-new table.
 * This runner replaces that with an ordered list applied exactly once per step, per database.
 *
 * A stored version **higher** than the newest migration this code knows about means a newer
 * build of the app (or a migration this code has never seen) already ran against this
 * database -- the downgrade case the audit calls out. Silently proceeding would let this,
 * older, code write through assumptions about a schema shape it does not understand, so this
 * throws instead of guessing: loud and safe beats quiet and wrong.
 */
export async function runSqliteMigrations(
  db: SqliteConnection,
  migrations: SqliteMigration[],
): Promise<void> {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const latestKnownVersion = ordered.length > 0 ? ordered[ordered.length - 1].version : 0;

  const rows = await db.getAllAsync<{ user_version: number }>('PRAGMA user_version', []);
  const currentVersion = rows[0]?.user_version ?? 0;

  if (currentVersion > latestKnownVersion) {
    throw new Error(
      `Database schema is at version ${currentVersion}, newer than this app build's latest ` +
        `known migration (${latestKnownVersion}). Refusing to open it: an older app writing ` +
        'through a schema it does not understand risks corrupting data. Update the app.',
    );
  }

  for (const migration of ordered) {
    if (migration.version <= currentVersion) {
      continue;
    }
    await migration.up(db);
    // Not parameterized -- PRAGMA does not accept bound parameters, and `version` is this
    // module's own integer, never user input.
    await db.execAsync(`PRAGMA user_version = ${migration.version}`);
  }
}
