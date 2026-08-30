import { ExerciseCategory, ExerciseGoal, ExerciseMeasure } from "@forjd/domain";

import { UpsertCatalogueExerciseInput } from "../exercises.repository";

/**
 * The fourth use of the adapter pattern in this codebase, alongside `AuthProvider`,
 * `StorageProvider` and `HealthProvider` (ADR-003, ADR-008): an external dataset is
 * normalized into the canonical model behind an interface, so adding a second exercise
 * source is a new adapter rather than a change to everything downstream of it.
 *
 * A normalized record is exactly `UpsertCatalogueExerciseInput` rather than a parallel type.
 * One shape, so the loader Phase E builds has nothing to translate and the two cannot drift.
 */
export type NormalizedExercise = UpsertCatalogueExerciseInput;

/**
 * A per-exercise correction, keyed by the source dataset's own id, applied on top of the
 * deterministic mapping tables. Only the three derived fields are overridable: everything
 * else either comes through from the source unchanged or is a mechanical mapping, and a
 * hand-edit there would be fixing the wrong thing.
 *
 * Lives at `packages/domain/data/exercise-overrides.json` -- version-controlled, reviewable
 * in a diff, and loaded as *data* rather than imported, so `packages/domain` keeps no
 * knowledge of any particular source dataset and stays free of runtime dependencies.
 */
export interface ExerciseOverride {
  category?: ExerciseCategory;
  goal?: ExerciseGoal;
  measure?: ExerciseMeasure;
}

export type ExerciseOverrides = Record<string, ExerciseOverride>;

export interface ExerciseSourceAdapter {
  /** Stamped onto every record's `source`, and half of the `(source, sourceId)` upsert key. */
  readonly source: string;

  /**
   * Normalizes the whole dataset in one pass.
   *
   * Whole-dataset rather than per-record because two of the guarantees are only checkable
   * across the set: that no two exercises collide on a slug, and that every override names
   * an id the dataset actually contains. Both throw rather than warn -- a silently dropped
   * exercise is indistinguishable from one the source never had.
   */
  normalizeAll(): NormalizedExercise[];
}
