import {
  Equipment,
  ExerciseCategory,
  ExerciseGoal,
  ExerciseMeasure,
  Force,
  FORCES,
  Level,
  LEVELS,
  Mechanic,
  MECHANICS,
  MuscleGroup,
} from "@forjd/domain";

/**
 * The deterministic half of the free-exercise-db normalizer. Every table here is total over
 * the values the pinned dataset actually contains (counted in
 * `apps/api/src/exercises/ingest/data/SOURCE.md`), and every lookup throws on a miss rather
 * than falling back to a default.
 *
 * Throwing is the whole design. A default would let a re-vendor introduce a new source value
 * and have it silently absorbed into `other`, or into whichever category happened to be the
 * fallback -- and nobody would find out until a user noticed a squat filed under mobility.
 * Failing at normalize time puts the decision back in front of a human, in a PR diff.
 *
 * Per-exercise exceptions do NOT belong here. They go in
 * `packages/domain/data/exercise-overrides.json`, which is applied on top.
 */

/** free-exercise-db's `category`. 7 distinct values at the pinned commit. */
const CATEGORY_BY_SOURCE_CATEGORY: Record<string, ExerciseCategory> = {
  // The four barbell-sport categories all describe loaded resistance work. The distinction
  // between them is competitive discipline, which the canonical vocabulary deliberately does
  // not model -- `goal` below is where powerlifting and olympic weightlifting actually differ.
  strength: "strength",
  powerlifting: "strength",
  "olympic weightlifting": "strength",
  strongman: "strength",
  stretching: "mobility",
  plyometrics: "cross_training",
  // 'cardio' is the loosest source category: 14 entries spanning treadmills, bikes, rowers,
  // skipping and a sled sprint. cross_training is the honest default; the four that are
  // literally running are corrected by the override file, not by a rule here.
  cardio: "cross_training",
};

/**
 * `goal` does not exist in free-exercise-db and is derived (ADR-005, SOURCE.md).
 *
 * Category decides it outright for six of the seven. Only `strength` needs a second input,
 * because it is the one category holding both heavy compound work and accessory isolation
 * work -- and telling those apart is exactly what `mechanic` records.
 */
const GOAL_BY_SOURCE_CATEGORY: Record<string, ExerciseGoal> = {
  powerlifting: "strength",
  "olympic weightlifting": "power",
  strongman: "power",
  plyometrics: "power",
  stretching: "mobility",
  cardio: "muscular_endurance",
};

/**
 * `measure` does not exist in free-exercise-db either.
 *
 * Anything absent from this table is measured by weight x reps, which is the right default
 * for every resistance movement including bodyweight ones -- the live workout screen logs
 * those as `BW x 12`, so "weight" is the unit of *logging*, not a claim that a load exists.
 */
const MEASURE_BY_SOURCE_CATEGORY: Record<string, ExerciseMeasure> = {
  stretching: "time",
  cardio: "distance",
};

/** free-exercise-db's `equipment`, free text. 12 distinct non-null values at the pin. */
const EQUIPMENT_BY_SOURCE_EQUIPMENT: Record<string, Equipment> = {
  "body only": "bodyweight",
  barbell: "barbell",
  dumbbell: "dumbbell",
  kettlebells: "kettlebell",
  machine: "machine",
  cable: "cable",
  bands: "band",
  "medicine ball": "medicine_ball",
  "exercise ball": "exercise_ball",
  "e-z curl bar": "ez_curl_bar",
  "foam roll": "foam_roller",
  // The source's own catch-all, kept as ours rather than guessed at. 122 exercises, spanning
  // sleds, atlas stones, tyres and rings -- splitting them would mean hand-classifying every
  // one, which is a curation project, not a mapping table.
  other: "other",
};

/** free-exercise-db's muscle names. 17 distinct values across both muscle arrays. */
const MUSCLE_BY_SOURCE_MUSCLE: Record<string, MuscleGroup> = {
  abdominals: "core",
  quadriceps: "quads",
  // The source distinguishes 'middle back' from 'lats' and 'lower back'; canonical `back` is
  // the mid-back group, with lats and lower_back as their own values, so this is a rename.
  "middle back": "back",
  "lower back": "lower_back",
  lats: "lats",
  traps: "traps",
  chest: "chest",
  shoulders: "shoulders",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  glutes: "glutes",
  hamstrings: "hamstrings",
  calves: "calves",
  abductors: "abductors",
  adductors: "adductors",
  neck: "neck",
};

const lookup = <T>(table: Record<string, T>, key: string, label: string): T => {
  const value = table[key];
  if (value === undefined) {
    throw new Error(
      `unmapped source ${label} "${key}". Add it to mappings.ts rather than defaulting it -- ` +
        `see that file's header for why there is no fallback.`,
    );
  }
  return value;
};

/**
 * `force`, `level` and `mechanic` need no mapping -- free-exercise-db's values are already
 * the canonical ones -- but they still need *checking*, and for a sharper reason than the
 * tables above.
 *
 * The DB columns are plain `text` with no constraint, and `ExercisesRepository` runs every
 * read through `keepKnownNullable(...)`, which turns any value outside the canonical tuple
 * into `null`. So an unvalidated off-vocabulary value would be written happily, then silently
 * vanish on the way back out: not rejected at ingest, not visible at read, just quietly gone.
 * That is precisely the failure this file's header says the throwing lookups exist to prevent,
 * and leaving these three unchecked would have been the one hole in it.
 */
const validateAgainst = <T extends string>(
  allowed: readonly T[],
  value: unknown,
  label: string,
): T => {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `unmapped source ${label} "${String(value)}". The source's vocabulary widened; decide ` +
        `what the new value means before it reaches the database.`,
    );
  }
  return value as T;
};

/** Null is legitimate -- 29 rows record no force at the pin -- and passes through untouched. */
export const checkForce = (value: Force | null): Force | null =>
  value === null ? null : validateAgainst(FORCES, value, "force");

/** Not nullable: every one of the 873 rows records a level, so an absent one is a real change. */
export const checkLevel = (value: Level): Level => validateAgainst(LEVELS, value, "level");

/** Null is legitimate -- 87 rows record no mechanic at the pin. */
export const checkMechanic = (value: Mechanic | null): Mechanic | null =>
  value === null ? null : validateAgainst(MECHANICS, value, "mechanic");

export const mapCategory = (sourceCategory: string): ExerciseCategory =>
  lookup(CATEGORY_BY_SOURCE_CATEGORY, sourceCategory, "category");

export const mapEquipment = (sourceEquipment: string): Equipment =>
  lookup(EQUIPMENT_BY_SOURCE_EQUIPMENT, sourceEquipment, "equipment");

export const mapMuscle = (sourceMuscle: string): MuscleGroup =>
  lookup(MUSCLE_BY_SOURCE_MUSCLE, sourceMuscle, "muscle");

export const deriveGoal = (sourceCategory: string, mechanic: Mechanic | null): ExerciseGoal => {
  const byCategory = GOAL_BY_SOURCE_CATEGORY[sourceCategory];
  if (byCategory !== undefined) {
    return byCategory;
  }
  // Only `strength` reaches here, and only because mapCategory rejects anything neither this
  // table nor CATEGORY_BY_SOURCE_CATEGORY knows about.
  mapCategory(sourceCategory);
  // An unrecorded mechanic (87 rows at the pin) falls to `strength` rather than `hypertrophy`:
  // compound outnumbers isolation nearly 2:1 in this dataset, and it matches the category's
  // own name, so it is the smaller assumption of the two.
  return mechanic === "isolation" ? "hypertrophy" : "strength";
};

export const deriveMeasure = (sourceCategory: string): ExerciseMeasure => {
  const byCategory = MEASURE_BY_SOURCE_CATEGORY[sourceCategory];
  if (byCategory !== undefined) {
    return byCategory;
  }
  mapCategory(sourceCategory);
  return "weight";
};

/**
 * Slug from name. Lowercase, ASCII, hyphen-separated, no leading or trailing hyphen.
 *
 * NFKD-normalizes and strips combining marks first so an accented name degrades to its base
 * letters instead of losing the character entirely. No name in the pinned dataset needs it --
 * all 873 are plain ASCII -- but a re-vendor is the point at which that stops being true, and
 * the alternative failure is a silently truncated slug.
 *
 * Uniqueness is NOT this function's job. Two different names can slugify to the same string
 * ("Sit Up" and "Sit-Up"), and the adapter rejects that across the whole set.
 */
export const slugify = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
