// docs/reviews/2026-10-14-emulator-walk.md, findings 1 and 2. Both on-device databases are opened once
// and kept (see shared-connection.ts for why a dropped handle closed the database for everyone), the
// exercise catalogue creates its tables as it opens (a fresh install used to fail "no such table:
// exercises_cache" on any screen that read it before the Library), and deleting a database closes
// the kept connection first.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  deleteDatabaseAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../sqlite-migrations', () => ({
  runSqliteMigrations: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';

import { deleteExerciseCatalogueDb, openExerciseCatalogueDb } from '../exercise-catalogue';
import { runSqliteMigrations } from '../sqlite-migrations';
import { deleteWorkoutSessionDb, openWorkoutSessionDb } from '../workout-session';

function fakeDb(name: string) {
  return { name, closeAsync: jest.fn().mockResolvedValue(undefined) };
}

const openDatabaseAsync = SQLite.openDatabaseAsync as jest.Mock;

beforeEach(async () => {
  // Each test starts with nothing kept from the last, and no stubbed answer carried over from it.
  await deleteWorkoutSessionDb();
  await deleteExerciseCatalogueDb();
  jest.clearAllMocks();
  openDatabaseAsync.mockReset();
  (runSqliteMigrations as jest.Mock).mockReset().mockResolvedValue(undefined);
});

describe('openWorkoutSessionDb', () => {
  it('opens the workout log once and hands back the same connection every time', async () => {
    const db = fakeDb('log');
    openDatabaseAsync.mockResolvedValue(db);

    const first = await openWorkoutSessionDb();
    const second = await openWorkoutSessionDb();

    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(first).toBe(db);
    expect(second).toBe(db);
  });

  it('closes the kept connection before deleting the file, then opens afresh', async () => {
    const before = fakeDb('before');
    const after = fakeDb('after');
    openDatabaseAsync.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    await openWorkoutSessionDb();

    await deleteWorkoutSessionDb();

    const deleteDatabaseAsync = SQLite.deleteDatabaseAsync as jest.Mock;
    expect(before.closeAsync).toHaveBeenCalledTimes(1);
    expect(deleteDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(before.closeAsync.mock.invocationCallOrder[0]).toBeLessThan(
      deleteDatabaseAsync.mock.invocationCallOrder[0] as number,
    );
    await expect(openWorkoutSessionDb()).resolves.toBe(after);
  });
});

describe('openExerciseCatalogueDb', () => {
  it('opens the catalogue once and makes sure of its tables on the kept connection every time', async () => {
    // The migrations are a no-op once applied, so checking on every open is cheap and leaves no
    // window in which a reader meets a fresh install's empty file.
    const db = fakeDb('catalogue');
    openDatabaseAsync.mockResolvedValue(db);

    const first = await openExerciseCatalogueDb();
    await openExerciseCatalogueDb();

    expect(first).toBe(db);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(runSqliteMigrations).toHaveBeenCalledTimes(2);
    for (const [connection] of (runSqliteMigrations as jest.Mock).mock.calls) expect(connection).toBe(db);
  });

  it('keeps the connection and tries the tables again when creating them failed', async () => {
    // Not reopened: a second handle to the same file, with the first dropped, is exactly what let a
    // garbage collection close the connection for everyone.
    const db = fakeDb('catalogue');
    openDatabaseAsync.mockResolvedValue(db);
    (runSqliteMigrations as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await expect(openExerciseCatalogueDb()).rejects.toThrow('disk full');
    await expect(openExerciseCatalogueDb()).resolves.toBe(db);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(runSqliteMigrations).toHaveBeenCalledTimes(2);
  });

  it('closes the kept connection before deleting the file', async () => {
    const db = fakeDb('catalogue');
    openDatabaseAsync.mockResolvedValue(db);
    await openExerciseCatalogueDb();

    await deleteExerciseCatalogueDb();

    expect(db.closeAsync).toHaveBeenCalledTimes(1);
    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledTimes(1);
  });
});
