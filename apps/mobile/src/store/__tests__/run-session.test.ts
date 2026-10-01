import {
  clearRunSnapshot,
  ensureRunSessionSchema,
  getUnfinishedRunSnapshot,
  saveRunSnapshot,
} from '../run-session';
import type { SqliteConnection } from '../exercise-catalogue';

/**
 * `expo-sqlite` cannot run under plain Jest, so this is exercised against the same kind of fake
 * `workout-session.test.ts` uses. Only `openWorkoutSessionDb` (shared with the strength runner)
 * touches the real module; a device walk is the check for that.
 */
class FakeSqliteConnection implements SqliteConnection {
  snapshots: Array<{ session_id: string; payload: string; started_at: string; account_id: string | null }> = [];
  userVersion: number;

  constructor(userVersion = 0) {
    this.userVersion = userVersion;
  }

  execAsync(source: string): Promise<void> {
    const versionMatch = /^\s*PRAGMA user_version\s*=\s*(\d+)/.exec(source);
    if (versionMatch) this.userVersion = Number(versionMatch[1]);
    return Promise.resolve();
  }

  withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return task();
  }

  async runAsync(source: string, params: unknown[]): Promise<unknown> {
    if (source.startsWith('INSERT OR REPLACE INTO run_snapshot')) {
      this.snapshots = [
        ...this.snapshots.filter((s) => s.session_id !== params[0]),
        { session_id: params[0] as string, payload: params[1] as string, started_at: params[2] as string, account_id: params[3] as string | null },
      ];
      return undefined;
    }
    if (source.startsWith('DELETE FROM run_snapshot')) {
      this.snapshots = this.snapshots.filter((s) => s.session_id !== params[0]);
      return undefined;
    }
    throw new Error(`FakeSqliteConnection: unhandled runAsync "${source}"`);
  }

  async getAllAsync<T>(source: string, params: unknown[]): Promise<T[]> {
    if (source.startsWith('SELECT session_id, payload, started_at, account_id FROM run_snapshot')) {
      return [...this.snapshots].sort((a, b) => b.started_at.localeCompare(a.started_at)) as T[];
    }
    if (source === 'PRAGMA user_version') {
      return [{ user_version: this.userVersion }] as T[];
    }
    throw new Error(`FakeSqliteConnection: unhandled getAllAsync "${source}"`);
  }
}

const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';

describe('run-session store', () => {
  let db: FakeSqliteConnection;

  beforeEach(async () => {
    db = new FakeSqliteConnection();
    await ensureRunSessionSchema(db);
  });

  describe('saveRunSnapshot / getUnfinishedRunSnapshot / clearRunSnapshot', () => {
    it('rebuilds the snapshot it was given', async () => {
      await saveRunSnapshot(db, ACCOUNT_A, 'run-1', { weightKg: 70 }, '2026-09-21T06:00:00.000Z');

      await expect(getUnfinishedRunSnapshot(db, ACCOUNT_A)).resolves.toEqual({
        sessionId: 'run-1',
        payload: { weightKg: 70 },
        startedAt: '2026-09-21T06:00:00.000Z',
      });
    });

    it('overwrites rather than duplicating on a second save for the same run', async () => {
      await saveRunSnapshot(db, ACCOUNT_A, 'run-1', { weightKg: 70 }, '2026-09-21T06:00:00.000Z');
      await saveRunSnapshot(db, ACCOUNT_A, 'run-1', { weightKg: 71, hasStartLocation: true }, '2026-09-21T06:00:00.000Z');

      const snapshot = await getUnfinishedRunSnapshot(db, ACCOUNT_A);
      expect(snapshot?.payload).toEqual({ weightKg: 71, hasStartLocation: true });
    });

    it('is null when there is nothing unfinished', async () => {
      await expect(getUnfinishedRunSnapshot(db, ACCOUNT_A)).resolves.toBeNull();
    });

    it("never offers another account's unfinished run, and keeps it for its owner (review 8.5, L3-1)", async () => {
      await saveRunSnapshot(db, ACCOUNT_A, 'run-a', { weightKg: 70 }, '2026-09-21T06:00:00.000Z');

      await expect(getUnfinishedRunSnapshot(db, ACCOUNT_B)).resolves.toBeNull();
      await expect(getUnfinishedRunSnapshot(db, null)).resolves.toBeNull();
      await expect(getUnfinishedRunSnapshot(db, ACCOUNT_A)).resolves.toEqual(
        expect.objectContaining({ sessionId: 'run-a' }),
      );
    });

    it('is gone after clearing', async () => {
      await saveRunSnapshot(db, ACCOUNT_A, 'run-1', {}, '2026-09-21T06:00:00.000Z');
      await clearRunSnapshot(db, 'run-1');
      await expect(getUnfinishedRunSnapshot(db, ACCOUNT_A)).resolves.toBeNull();
    });
  });

  describe('ensureRunSessionSchema', () => {
    it('is safe to run more than once', async () => {
      await ensureRunSessionSchema(db);
      await ensureRunSessionSchema(db);
      await expect(getUnfinishedRunSnapshot(db, ACCOUNT_A)).resolves.toBeNull();
    });

    it('brings a fresh device up to the same schema version as the strength runner, called alone', async () => {
      // A device that opens the run screen before ever starting a strength workout must not stop
      // ensureWorkoutSessionSchema from later applying v1/v2: both share one migration list.
      const fresh = new FakeSqliteConnection();
      await ensureRunSessionSchema(fresh);
      expect(fresh.userVersion).toBeGreaterThanOrEqual(3);
    });

    it('does not throw as a downgrade when the other caller runs afterwards', async () => {
      const fresh = new FakeSqliteConnection();
      await ensureRunSessionSchema(fresh);

      const { ensureWorkoutSessionSchema } = require('../workout-session') as typeof import('../workout-session');
      await expect(ensureWorkoutSessionSchema(fresh)).resolves.not.toThrow();
    });
  });
});
