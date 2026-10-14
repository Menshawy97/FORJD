// Owner decision 2026-10-14 (emulator walk finding 3): the exercise catalogue downloads at app start and at sign-in,
// not only when the Library is opened, so a workout opened first shows its exercises' names. The server answers
// "not modified" when nothing changed, so after the first time this costs almost nothing. It never throws.
import type { SqliteConnection } from '@/store/exercise-catalogue';

import { refreshExerciseCatalogue } from '../refresh-catalogue';

const fakeDb = (id: string) => ({ id }) as unknown as SqliteConnection;

describe('refreshExerciseCatalogue', () => {
  it('opens the catalogue and syncs it from the server', async () => {
    const db = fakeDb('catalogue');
    const fetchCatalogue = jest.fn();
    const sync = jest.fn(async () => ({ synced: true, count: 878 }));

    await expect(refreshExerciseCatalogue({ open: async () => db, sync, fetchCatalogue })).resolves.toBe(true);
    expect(sync).toHaveBeenCalledWith(db, fetchCatalogue);
  });

  it('reports false, without throwing, when offline or the database fails', async () => {
    const sync = jest.fn(async () => {
      throw new Error('Network Error');
    });

    await expect(refreshExerciseCatalogue({ open: async () => fakeDb('empty'), sync, fetchCatalogue: jest.fn() })).resolves.toBe(false);
    await expect(
      refreshExerciseCatalogue({
        open: async () => {
          throw new Error('no file');
        },
        sync,
        fetchCatalogue: jest.fn(),
      }),
    ).resolves.toBe(false);
  });
});
