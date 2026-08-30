import {
  EXERCISE_CATEGORIES,
  EXERCISE_GOALS,
  EXERCISE_MEASURES,
  ExerciseCategory,
  ExerciseGoal,
  ExerciseMeasure,
  Force,
  Level,
  Mechanic,
} from "@forjd/domain";

import {
  ExerciseOverride,
  ExerciseOverrides,
  ExerciseSourceAdapter,
  NormalizedExercise,
} from "./exercise-source-adapter.interface";
import {
  checkForce,
  checkLevel,
  checkMechanic,
  deriveGoal,
  deriveMeasure,
  mapCategory,
  mapEquipment,
  mapMuscle,
  slugify,
} from "./mappings";

/**
 * One record of `dist/exercises.json` from yuhonas/free-exercise-db, at the commit pinned in
 * `data/SOURCE.md`. Typed exactly as the JSON is, including the nullable fields -- the whole
 * point of this file is to be the one place that knows the source's shape.
 *
 * `force`, `level` and `mechanic` are declared as the canonical types because the source's
 * values already match them one-for-one (`push|pull|static`, `beginner|intermediate|expert`,
 * `compound|isolation`), which SOURCE.md records from a count over the real data.
 */
export interface FreeExerciseDbRow {
  id: string;
  name: string;
  category: string;
  equipment: string | null;
  force: Force | null;
  level: Level;
  mechanic: Mechanic | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  images: string[];
}

const SOURCE = "free-exercise-db";

const CATEGORY_VALUES = new Set<string>(EXERCISE_CATEGORIES);
const GOAL_VALUES = new Set<string>(EXERCISE_GOALS);
const MEASURE_VALUES = new Set<string>(EXERCISE_MEASURES);

/**
 * Normalizes free-exercise-db into the canonical `Exercise` model (ADR-005, ADR-017).
 *
 * Pure by construction: the rows and the override table are constructor arguments, and the
 * class does no I/O. Reading the vendored dataset and the override file belongs to
 * `scripts/normalize-exercises.ts`. That split is what lets the golden-fixture tests assert an
 * exact record for a hand-built input, and it keeps a filesystem path out of the code path
 * Phase E's loader will call.
 */
export class FreeExerciseDbAdapter implements ExerciseSourceAdapter {
  readonly source = SOURCE;

  constructor(
    private readonly rows: readonly FreeExerciseDbRow[],
    private readonly overrides: ExerciseOverrides,
  ) {}

  normalizeAll(): NormalizedExercise[] {
    this.assertOverridesAreWellFormed();

    const seenSourceIds = new Set<string>();
    const seenSlugs = new Map<string, string>();
    const normalized: NormalizedExercise[] = [];

    for (const row of this.rows) {
      if (seenSourceIds.has(row.id)) {
        throw new Error(
          `duplicate source id "${row.id}" in the dataset. (source, sourceId) is the upsert ` +
            `key, so a duplicate would silently overwrite the earlier exercise.`,
        );
      }
      seenSourceIds.add(row.id);

      const exercise = this.normalizeRow(row);

      const collidesWith = seenSlugs.get(exercise.slug);
      if (collidesWith !== undefined) {
        throw new Error(
          `duplicate slug "${exercise.slug}": "${collidesWith}" and "${row.name}" normalize to ` +
            `the same slug. Disambiguate one of the names, or give the slug its own override.`,
        );
      }
      seenSlugs.set(exercise.slug, row.name);

      normalized.push(exercise);
    }

    return normalized;
  }

  private normalizeRow(row: FreeExerciseDbRow): NormalizedExercise {
    const override: ExerciseOverride = this.overrides[row.id] ?? {};

    return {
      source: SOURCE,
      sourceId: row.id,
      name: row.name,
      slug: slugify(row.name),
      category: override.category ?? mapCategory(row.category),
      goal: override.goal ?? deriveGoal(row.category, row.mechanic),
      measure: override.measure ?? deriveMeasure(row.category),
      primaryMuscles: row.primaryMuscles.map(mapMuscle),
      secondaryMuscles: row.secondaryMuscles.map(mapMuscle),
      // A row with no equipment recorded yields an empty array, not `other`. "The source did
      // not say" and "the source said something we could not place" are different facts, and
      // collapsing them would file 77 exercises under a bucket the source never assigned them.
      equipment: row.equipment === null ? [] : [mapEquipment(row.equipment)],
      // Checked, not merely copied. The declared types on FreeExerciseDbRow are an assertion
      // about JSON, and an assertion is not a guarantee -- see checkForce's comment in
      // mappings.ts for what an unchecked value would do downstream.
      force: checkForce(row.force),
      level: checkLevel(row.level),
      mechanic: checkMechanic(row.mechanic),
      instructions: row.instructions,
      // Paths, stored verbatim as storage keys rather than resolved to URLs (ADR-018) -- so
      // replacing the stopgap imagery later is a config change, not a migration.
      imageKeys: row.images,
      // free-exercise-db has no description field, and `instructions` is not one: it is a
      // step list the detail screen renders separately.
      description: null,
    };
  }

  /**
   * Validates the override table before normalizing anything, so a bad override fails on its
   * own terms rather than as a confusing downstream error.
   *
   * Both checks reject rather than ignore. An override naming an id the dataset no longer has
   * is the signal that a re-vendor dropped an exercise -- exactly the thing worth knowing
   * about, and exactly the thing a lenient loader would hide.
   */
  private assertOverridesAreWellFormed(): void {
    const sourceIds = new Set(this.rows.map((row) => row.id));

    for (const [sourceId, override] of Object.entries(this.overrides)) {
      if (!sourceIds.has(sourceId)) {
        throw new Error(
          `override targets unknown source id "${sourceId}". Either the dataset was ` +
            `re-vendored and this exercise is gone, or the id is a typo.`,
        );
      }
      assertInVocabulary<ExerciseCategory>(
        override.category,
        CATEGORY_VALUES,
        "category",
        sourceId,
      );
      assertInVocabulary<ExerciseGoal>(override.goal, GOAL_VALUES, "goal", sourceId);
      assertInVocabulary<ExerciseMeasure>(override.measure, MEASURE_VALUES, "measure", sourceId);
    }
  }
}

/**
 * The override file is JSON, so TypeScript's view of its contents is an assertion rather than
 * a guarantee. This is where that assertion is checked against the real tuples in
 * `@forjd/domain` -- without it a typo would travel all the way into a database column whose
 * value no `ExerciseCategory` switch anywhere else in the app would handle.
 */
function assertInVocabulary<T extends string>(
  value: T | undefined,
  allowed: ReadonlySet<string>,
  field: string,
  sourceId: string,
): void {
  if (value !== undefined && !allowed.has(value)) {
    throw new Error(
      `invalid override ${field} "${value}" for "${sourceId}". Allowed: ` +
        `${[...allowed].join(", ")}.`,
    );
  }
}
