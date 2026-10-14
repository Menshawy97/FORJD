// The phone's memory of last time's sets per exercise (docs/product/live-prev-column-plan.md), so PREV and the
// start-filled sets work without signal. One row per account and exercise; a newer workout replaces an older one, never
// the other way round; another account on the same phone never sees it.
import type { SqliteConnection } from '../exercise-catalogue';
import { PREVIOUS_SETS_MIGRATION, readPreviousSets, rememberPreviousSets } from '../previous-sets';

/** The two statements this store sends, kept as rows by their key; no SQL engine (expo-sqlite cannot run in Jest). */
class FakeDb implements SqliteConnection {
  rows = new Map<string, { performed_at: string; sets: string }>();
  executed: string[] = [];
  execAsync(source: string): Promise<void> {
    this.executed.push(source);
    return Promise.resolve();
  }
  runAsync(_source: string, params: unknown[]): Promise<unknown> {
    const [account, exercise, performedAt, sets] = params as string[];
    this.rows.set(`${account}|${exercise}`, { performed_at: performedAt!, sets: sets! });
    return Promise.resolve();
  }
  getAllAsync<T>(_source: string, params: unknown[]): Promise<T[]> {
    const [account, exercise] = params as string[];
    const row = this.rows.get(`${account}|${exercise}`);
    return Promise.resolve((row ? [row] : []) as T[]);
  }
  withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return task();
  }
}

const BENCH = '11111111-1111-4111-8111-111111111111';
const SETS = [{ weightKg: 40, reps: 10, durationSeconds: null, distanceMeters: null }];

describe('previous sets on the phone', () => {
  it('creates its table as the next step of the workout-log migrations', async () => {
    const db = new FakeDb();

    await PREVIOUS_SETS_MIGRATION.up(db);

    expect(PREVIOUS_SETS_MIGRATION.version).toBe(6);
    expect(db.executed.join('\n')).toMatch(/CREATE TABLE IF NOT EXISTS previous_sets/);
  });

  it('remembers an exercise and reads it back', async () => {
    const db = new FakeDb();

    await rememberPreviousSets(db, 'acct-1', BENCH, '2026-10-10T09:00:00.000Z', SETS);

    await expect(readPreviousSets(db, 'acct-1', BENCH)).resolves.toEqual({
      performedAt: '2026-10-10T09:00:00.000Z',
      sets: SETS,
    });
  });

  it('keeps the newer workout when an older one arrives later', async () => {
    const db = new FakeDb();
    await rememberPreviousSets(db, 'acct-1', BENCH, '2026-10-12T09:00:00.000Z', SETS);

    const older = [{ weightKg: 30, reps: 12, durationSeconds: null, distanceMeters: null }];
    await rememberPreviousSets(db, 'acct-1', BENCH, '2026-10-01T09:00:00.000Z', older);

    expect((await readPreviousSets(db, 'acct-1', BENCH))?.sets).toEqual(SETS);
  });

  it("never shows one account another's sets, and keeps nothing without an account", async () => {
    const db = new FakeDb();
    await rememberPreviousSets(db, 'acct-1', BENCH, '2026-10-10T09:00:00.000Z', SETS);
    await rememberPreviousSets(db, null, BENCH, '2026-10-11T09:00:00.000Z', SETS);

    await expect(readPreviousSets(db, 'acct-2', BENCH)).resolves.toBeNull();
    await expect(readPreviousSets(db, null, BENCH)).resolves.toBeNull();
    expect(db.rows.size).toBe(1);
  });

  it('reads a damaged row as nothing rather than throwing', async () => {
    const db = new FakeDb();
    db.rows.set(`acct-1|${BENCH}`, { performed_at: '2026-10-10T09:00:00.000Z', sets: 'not json' });

    await expect(readPreviousSets(db, 'acct-1', BENCH)).resolves.toBeNull();
  });
});
