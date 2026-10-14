import { getExerciseCatalogue } from '@/auth/apiClient';
import { openExerciseCatalogueDb, syncExerciseCatalogue, type SqliteConnection } from '@/store/exercise-catalogue';

/**
 * Downloads the exercise catalogue at app start and at sign-in (owner decision 2026-10-14, emulator walk finding 3),
 * not only when the Library is opened: until then a workout showed its exercises as "Exercise". The server answers
 * "not modified" when nothing changed, so after the first download this is one small request. Never throws: offline,
 * the phone keeps the catalogue it has.
 *
 * Returns whether the catalogue was rebuilt from the server.
 */
export interface RefreshCatalogueDeps {
  open: () => Promise<SqliteConnection>;
  sync: typeof syncExerciseCatalogue;
  fetchCatalogue: typeof getExerciseCatalogue;
}

const defaultDeps: RefreshCatalogueDeps = {
  open: openExerciseCatalogueDb,
  sync: syncExerciseCatalogue,
  fetchCatalogue: getExerciseCatalogue,
};

export async function refreshExerciseCatalogue(deps: RefreshCatalogueDeps = defaultDeps): Promise<boolean> {
  try {
    const db = await deps.open();
    const { synced } = await deps.sync(db, deps.fetchCatalogue);
    return synced;
  } catch {
    return false;
  }
}
