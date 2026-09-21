import {
  appendRunPoint,
  clearRunPoints,
  clearRunSnapshot,
  ensureRunSessionSchema,
  getRunPoints,
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
  points: Array<{ id: number; session_id: string; payload: string }> = [];
  nextPointId = 1;
  snapshot: { session_id: string; payload: string; started_at: string } | null = null;
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
    if (source.startsWith('INSERT INTO run_points')) {
      this.points.push({ id: this.nextPointId++, session_id: params[0] as string, payload: params[1] as string });
      return undefined;
    }
    if (source.startsWith('DELETE FROM run_points')) {
      this.points = this.points.filter((p) => p.session_id !== params[0]);
      return undefined;
    }
    if (source.startsWith('INSERT OR REPLACE INTO run_snapshot')) {
      this.snapshot = { session_id: params[0] as string, payload: params[1] as string, started_at: params[2] as string };
      return undefined;
    }
    if (source.startsWith('DELETE FROM run_snapshot')) {
      if (this.snapshot?.session_id === params[0]) this.snapshot = null;
      return undefined;
    }
    throw new Error(`FakeSqliteConnection: unhandled runAsync "${source}"`);
  }

  async getAllAsync<T>(source: string, params: unknown[]): Promise<T[]> {
    if (source.startsWith('SELECT payload FROM run_points')) {
      return this.points
        .filter((p) => p.session_id === params[0])
        .sort((a, b) => a.id - b.id)
        .map((p) => ({ payload: p.payload }) as T);
    }
    if (source.startsWith('SELECT session_id, payload, started_at FROM run_snapshot')) {
      return (this.snapshot ? [this.snapshot] : []) as T[];
    }
    if (source === 'PRAGMA user_version') {
      return [{ user_version: this.userVersion }] as T[];
    }
    throw new Error(`FakeSqliteConnection: unhandled getAllAsync "${source}"`);
  }
}

describe('run-session store', () => {
  let db: FakeSqliteConnection;

  beforeEach(async () => {
    db = new FakeSqliteConnection();
    await ensureRunSessionSchema(db);
  });

  describe('appendRunPoint / getRunPoints / clearRunPoints', () => {
    it('reads points back in the order they were written', async () => {
      await appendRunPoint(db, 'run-1', { latitude: 31.2, longitude: 29.9, movingMs: 0 });
      await appendRunPoint(db, 'run-1', { latitude: 31.201, longitude: 29.901, movingMs: 1000 });

      const points = await getRunPoints(db, 'run-1');

      expect(points).toEqual([
        { latitude: 31.2, longitude: 29.9, movingMs: 0 },
        { latitude: 31.201, longitude: 29.901, movingMs: 1000 },
      ]);
    });

    it('keeps points from different runs apart', async () => {
      await appendRunPoint(db, 'run-1', { latitude: 1, longitude: 1, movingMs: 0 });
      await appendRunPoint(db, 'run-2', { latitude: 2, longitude: 2, movingMs: 0 });

      await expect(getRunPoints(db, 'run-1')).resolves.toHaveLength(1);
      await expect(getRunPoints(db, 'run-2')).resolves.toHaveLength(1);
    });

    it('returns an empty list for a run with no points yet', async () => {
      await expect(getRunPoints(db, 'run-none')).resolves.toEqual([]);
    });

    it('clears only the named run', async () => {
      await appendRunPoint(db, 'run-1', { latitude: 1, longitude: 1, movingMs: 0 });
      await appendRunPoint(db, 'run-2', { latitude: 2, longitude: 2, movingMs: 0 });

      await clearRunPoints(db, 'run-1');

      await expect(getRunPoints(db, 'run-1')).resolves.toEqual([]);
      await expect(getRunPoints(db, 'run-2')).resolves.toHaveLength(1);
    });
  });

  describe('saveRunSnapshot / getUnfinishedRunSnapshot / clearRunSnapshot', () => {
    it('rebuilds the snapshot it was given', async () => {
      await saveRunSnapshot(db, 'run-1', { weightKg: 70 }, '2026-09-21T06:00:00.000Z');

      await expect(getUnfinishedRunSnapshot(db)).resolves.toEqual({
        sessionId: 'run-1',
        payload: { weightKg: 70 },
        startedAt: '2026-09-21T06:00:00.000Z',
      });
    });

    it('overwrites rather than duplicating on a second save for the same run', async () => {
      await saveRunSnapshot(db, 'run-1', { weightKg: 70 }, '2026-09-21T06:00:00.000Z');
      await saveRunSnapshot(db, 'run-1', { weightKg: 71, hasStartLocation: true }, '2026-09-21T06:00:00.000Z');

      const snapshot = await getUnfinishedRunSnapshot(db);
      expect(snapshot?.payload).toEqual({ weightKg: 71, hasStartLocation: true });
    });

    it('is null when there is nothing unfinished', async () => {
      await expect(getUnfinishedRunSnapshot(db)).resolves.toBeNull();
    });

    it('is gone after clearing', async () => {
      await saveRunSnapshot(db, 'run-1', {}, '2026-09-21T06:00:00.000Z');
      await clearRunSnapshot(db, 'run-1');
      await expect(getUnfinishedRunSnapshot(db)).resolves.toBeNull();
    });
  });

  describe('ensureRunSessionSchema', () => {
    it('is safe to run more than once', async () => {
      await ensureRunSessionSchema(db);
      await ensureRunSessionSchema(db);
      await expect(getRunPoints(db, 'run-1')).resolves.toEqual([]);
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
