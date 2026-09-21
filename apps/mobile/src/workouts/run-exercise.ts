import type { ExerciseResponse } from '@forjd/contracts';

import type { SqliteConnection } from '@/store/exercise-catalogue';
import { searchExercises } from '@/store/exercise-catalogue';

import { RUN_EXERCISE_SLUG } from './live-run';

/**
 * The real id of the curated "Outdoor Run" exercise (ADR-050), looked up in the on-device
 * catalogue mirror. The server assigns this id when it seeds the catalogue, so a run recorded
 * offline cannot know it yet and carries `RUN_EXERCISE_PLACEHOLDER_ID` in its place until this
 * resolves it, just before upload (`sync-sessions.ts`).
 *
 * The device catalogue mirror already carries every exercise, including the curated ones
 * (`syncExerciseCatalogue`), so this is a local, offline-capable lookup, not a network call —
 * consistent with rule 6 (the network is never in the critical path here either, since a failed
 * lookup simply leaves the run queued for the next sync attempt rather than failing the upload).
 *
 * `null` when the catalogue has not synced this exercise in yet, or the lookup itself fails; the
 * caller (`sync-sessions.ts`) treats that as "try again later", never as a reason to drop the run.
 */
export async function resolveRunExerciseId(
  db: SqliteConnection,
  search: (db: SqliteConnection, query: string) => Promise<ExerciseResponse[]> = searchExercises,
): Promise<string | null> {
  try {
    const results = await search(db, 'Outdoor Run');
    return results.find((exercise) => exercise.slug === RUN_EXERCISE_SLUG)?.id ?? null;
  } catch {
    return null;
  }
}
