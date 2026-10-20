// Owner decision 2026-10-14 (emulator walk finding 3): the exercise catalogue downloads at app start and at sign-in,
// not only when the Library is opened, so a workout opened first shows its exercises' names. The server answers
// "not modified" when nothing changed, so after the first time this costs almost nothing. It never throws.
import { dateOfBirthProvided, requireDateOfBirth, resetDateOfBirthGate } from '@/auth/date-of-birth-gate';
import type { SqliteConnection } from '@/store/exercise-catalogue';

import { refreshCatalogueOnceDateOfBirthGiven, refreshExerciseCatalogue } from '../refresh-catalogue';

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

// Production smoke test 2026-10-20: a new account's first download happens before it has a date of birth, so the
// server refuses it (`date_of_birth_required`, ADR-042) and every workout showed "Exercise" until the Library was
// opened. The download is tried again the moment the date is accepted.
describe('refreshCatalogueOnceDateOfBirthGiven', () => {
  afterEach(() => resetDateOfBirthGate());

  it('downloads again when the date of birth is accepted', () => {
    const refresh = jest.fn(async () => true);
    const stop = refreshCatalogueOnceDateOfBirthGiven(refresh);

    requireDateOfBirth();
    expect(refresh).not.toHaveBeenCalled();
    dateOfBirthProvided();
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('downloads even when the refusal never raised the gate (sign-up goes straight to the date screen)', () => {
    const refresh = jest.fn(async () => true);
    const stop = refreshCatalogueOnceDateOfBirthGiven(refresh);

    dateOfBirthProvided();
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops downloading once it stops listening', () => {
    const refresh = jest.fn(async () => true);
    const stop = refreshCatalogueOnceDateOfBirthGiven(refresh);

    stop();
    dateOfBirthProvided();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not download on sign-out, which also clears the gate', () => {
    const refresh = jest.fn(async () => true);
    const stop = refreshCatalogueOnceDateOfBirthGiven(refresh);

    requireDateOfBirth();
    resetDateOfBirthGate();
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });
});
