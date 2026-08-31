import type { ExerciseCatalogueResponse, ExerciseResponse } from '@forjd/contracts';

import {
  ensureExerciseCatalogueSchema,
  getCachedExercise,
  getStoredCatalogueVersion,
  searchExercises,
  setLocalFavourite,
  SqliteConnection,
  syncExerciseCatalogue,
} from '../exercise-catalogue';

/**
 * `expo-sqlite`'s native module cannot run under plain Jest, so every function under test is
 * exercised against `FakeSqliteConnection` -- a real, in-memory SQL engine is not needed
 * either, since what is under test is this module's own logic (version-gating, the
 * strip-and-reattach of `isFavourite`, the FTS query construction), not SQLite's. Only
 * `openExerciseCatalogueDb` touches the real API, and it is one line deliberately left
 * unwrapped and untested here -- a device walk is the real check for that, the same
 * "Jest cannot prove a screen renders on a device" limitation this codebase already accepts
 * for HealthKit/Health Connect.
 */
class FakeSqliteConnection implements SqliteConnection {
  cache = new Map<string, { name: string; category: string; is_custom: number; is_favourite: number; data: string }>();
  fts = new Map<string, { name: string; muscles: string; equipment: string }>();
  meta = new Map<string, string>();

  execAsync(): Promise<void> {
    return Promise.resolve();
  }

  runAsync(source: string, params: unknown[] = []): Promise<unknown> {
    if (source.startsWith('DELETE FROM exercises_cache')) {
      this.cache.clear();
    } else if (source.startsWith('DELETE FROM exercises_fts')) {
      this.fts.clear();
    } else if (source.startsWith('INSERT INTO exercises_cache')) {
      const [id, name, category, isCustom, isFavourite, data] = params as [
        string,
        string,
        string,
        number,
        number,
        string,
      ];
      this.cache.set(id, { name, category, is_custom: isCustom, is_favourite: isFavourite, data });
    } else if (source.startsWith('INSERT INTO exercises_fts')) {
      const [id, name, muscles, equipment] = params as [string, string, string, string];
      this.fts.set(id, { name, muscles, equipment });
    } else if (source.startsWith('INSERT OR REPLACE INTO catalogue_meta')) {
      const [key, value] = params as [string, string];
      this.meta.set(key, value);
    } else if (source.startsWith('UPDATE exercises_cache SET is_favourite')) {
      const [isFavourite, id] = params as [number, string];
      const row = this.cache.get(id as string);
      if (row) {
        row.is_favourite = isFavourite;
      }
    } else {
      throw new Error(`FakeSqliteConnection: unhandled statement: ${source}`);
    }
    return Promise.resolve(undefined);
  }

  getAllAsync<T>(source: string, params: unknown[] = []): Promise<T[]> {
    if (source.startsWith('SELECT value FROM catalogue_meta')) {
      const [key] = params as [string];
      const value = this.meta.get(key);
      return Promise.resolve((value !== undefined ? [{ value }] : []) as T[]);
    }
    if (source.startsWith('SELECT c.data')) {
      const [matchQuery] = params as [string];
      const terms = matchQuery.split(' ').map((term) => term.replace(/\*$/, '').toLowerCase());
      const matches = [...this.fts.entries()]
        .filter(([, row]) => {
          const haystack = `${row.name} ${row.muscles} ${row.equipment}`.toLowerCase();
          return terms.every((term) => haystack.split(/\s+/).some((word) => word.startsWith(term)));
        })
        .map(([id]) => id)
        .sort((a, b) => (this.cache.get(a)?.name ?? '').localeCompare(this.cache.get(b)?.name ?? ''));
      return Promise.resolve(
        matches.map((id) => {
          const row = this.cache.get(id);
          if (!row) {
            throw new Error(`fts row ${id} has no matching cache row`);
          }
          return { data: row.data, is_favourite: row.is_favourite } as T;
        }),
      );
    }
    if (source.startsWith('SELECT data, is_favourite FROM exercises_cache')) {
      const [id] = params as [string];
      const row = this.cache.get(id);
      return Promise.resolve((row ? [{ data: row.data, is_favourite: row.is_favourite }] : []) as T[]);
    }
    throw new Error(`FakeSqliteConnection: unhandled query: ${source}`);
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  }
}

const exercise = (overrides: Partial<ExerciseResponse> = {}): ExerciseResponse => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Barbell Bench Press',
  slug: 'barbell-bench-press',
  category: 'strength',
  goal: 'hypertrophy',
  measure: 'weight',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  equipment: ['barbell'],
  force: 'push',
  level: 'beginner',
  mechanic: 'compound',
  instructions: ['Lie on the bench.'],
  imageUrls: [],
  description: null,
  isCustom: false,
  isFavourite: false,
  ...overrides,
});

const catalogueOf = (
  exercises: ExerciseResponse[],
  catalogueVersion = 'v1',
): ExerciseCatalogueResponse => ({ exercises, catalogueVersion });

describe('exercise catalogue store', () => {
  describe('syncExerciseCatalogue', () => {
    it('populates the cache and stores the version on first sync', async () => {
      const db = new FakeSqliteConnection();

      const result = await syncExerciseCatalogue(db, () => Promise.resolve(catalogueOf([exercise()])));

      expect(result).toEqual({ synced: true, count: 1 });
      expect(await getStoredCatalogueVersion(db)).toBe('v1');
    });

    it('skips the rebuild when the version has not changed', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () => Promise.resolve(catalogueOf([exercise()])));

      const result = await syncExerciseCatalogue(db, () => Promise.resolve(catalogueOf([exercise()])));

      expect(result.synced).toBe(false);
    });

    it('replaces the whole cache when the version has changed', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () =>
        Promise.resolve(catalogueOf([exercise({ id: 'a', name: 'Old One' })], 'v1')),
      );

      await syncExerciseCatalogue(db, () =>
        Promise.resolve(catalogueOf([exercise({ id: 'b', name: 'New One' })], 'v2')),
      );

      expect(await getCachedExercise(db, 'a')).toBeNull();
      expect(await getCachedExercise(db, 'b')).not.toBeNull();
      expect(await getStoredCatalogueVersion(db)).toBe('v2');
    });

    it('creates the schema on its own -- a caller never has to call ensureExerciseCatalogueSchema first', async () => {
      const db = new FakeSqliteConnection();

      await expect(
        syncExerciseCatalogue(db, () => Promise.resolve(catalogueOf([exercise()]))),
      ).resolves.not.toThrow();
    });
  });

  describe('ensureExerciseCatalogueSchema', () => {
    it('is idempotent -- calling it twice does not throw', async () => {
      const db = new FakeSqliteConnection();

      await ensureExerciseCatalogueSchema(db);
      await expect(ensureExerciseCatalogueSchema(db)).resolves.toBeUndefined();
    });
  });

  describe('getCachedExercise', () => {
    it('returns null for an id that was never synced', async () => {
      const db = new FakeSqliteConnection();

      expect(await getCachedExercise(db, 'nope')).toBeNull();
    });

    it('reattaches isFavourite from its own column, not the stored JSON blob', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () =>
        Promise.resolve(catalogueOf([exercise({ id: 'a', isFavourite: true })])),
      );

      expect((await getCachedExercise(db, 'a'))?.isFavourite).toBe(true);
    });
  });

  describe('searchExercises', () => {
    it('finds an exercise by a name prefix', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () =>
        Promise.resolve(catalogueOf([exercise({ id: 'a', name: 'Barbell Bench Press' })])),
      );

      const results = await searchExercises(db, 'bench');

      expect(results.map((row) => row.id)).toEqual(['a']);
    });

    it('finds an exercise by a muscle it targets', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () =>
        Promise.resolve(
          catalogueOf([exercise({ id: 'a', name: 'Something Else', primaryMuscles: ['glutes'] })]),
        ),
      );

      const results = await searchExercises(db, 'glutes');

      expect(results.map((row) => row.id)).toEqual(['a']);
    });

    it('finds an exercise by equipment', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () =>
        Promise.resolve(catalogueOf([exercise({ id: 'a', name: 'Something Else', equipment: ['kettlebell'] })])),
      );

      const results = await searchExercises(db, 'kettlebell');

      expect(results.map((row) => row.id)).toEqual(['a']);
    });

    it('returns an empty array for a blank query rather than every row', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () => Promise.resolve(catalogueOf([exercise()])));

      expect(await searchExercises(db, '   ')).toEqual([]);
    });

    it('returns an empty array when nothing matches', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () => Promise.resolve(catalogueOf([exercise()])));

      expect(await searchExercises(db, 'zzzznomatch')).toEqual([]);
    });
  });

  describe('setLocalFavourite', () => {
    it('updates the cached row without waiting for the next sync', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () =>
        Promise.resolve(catalogueOf([exercise({ id: 'a', isFavourite: false })])),
      );

      await setLocalFavourite(db, 'a', true);

      expect((await getCachedExercise(db, 'a'))?.isFavourite).toBe(true);
    });

    it('does not touch the stored catalogueVersion', async () => {
      const db = new FakeSqliteConnection();
      await syncExerciseCatalogue(db, () => Promise.resolve(catalogueOf([exercise({ id: 'a' })])));

      await setLocalFavourite(db, 'a', true);

      expect(await getStoredCatalogueVersion(db)).toBe('v1');
    });
  });
});
