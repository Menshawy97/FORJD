/**
 * Canonical exercise vocabulary (Phase 2, ADR-017). Every closed value set below is an
 * `as const` tuple with a companion display-name map — the same pattern established in
 * ./index.ts for `TRAINING_GOALS`/`ACTIVITIES` — so @forjd/contracts can build `z.enum(...)`
 * from the tuple instead of restating the values, and the UI never hardcodes a label.
 *
 * All of these back `text` / `text[]` columns, never Postgres enums, for the same reason
 * `Sex` is `text`: narrowing a tuple is free, narrowing a PG enum is impossible.
 *
 * The categories are the design's own filter chips
 * (docs/design/phase2-screen-specs.md #3.4), not free-exercise-db's seven source categories
 * (strength/stretching/plyometrics/strongman/powerlifting/cardio/olympic weightlifting) —
 * mapping between the two is the ingest adapter's job (Phase D), which is the whole point of
 * the adapter pattern.
 */
export const EXERCISE_CATEGORIES = [
  "strength",
  "running",
  "cross_training",
  "yoga",
  "calisthenics",
  "mobility",
] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

export const EXERCISE_CATEGORY_DISPLAY_NAMES: Record<ExerciseCategory, string> = {
  strength: "Strength",
  running: "Running",
  cross_training: "Cross Training",
  yoga: "Yoga",
  calisthenics: "Calisthenics",
  mobility: "Mobility",
};

/**
 * free-exercise-db has no `goal` field. The ingest adapter derives one from
 * category/mechanic/force (Phase D) — this tuple is the target of that derivation, not a
 * copy of anything in the source data.
 */
export const EXERCISE_GOALS = [
  "strength",
  "hypertrophy",
  "power",
  "muscular_endurance",
  "mobility",
] as const;
export type ExerciseGoal = (typeof EXERCISE_GOALS)[number];

export const EXERCISE_GOAL_DISPLAY_NAMES: Record<ExerciseGoal, string> = {
  strength: "Strength",
  hypertrophy: "Hypertrophy",
  power: "Power",
  muscular_endurance: "Muscular endurance",
  mobility: "Mobility",
};

/**
 * How a set of this exercise is logged. Also absent from free-exercise-db; the adapter
 * derives it from category (Phase D). Matches the three options the custom-exercise
 * screen's "Measured by" row offers (docs/design/phase2-screen-specs.md #6.1 item 6).
 */
export const EXERCISE_MEASURES = ["weight", "time", "distance"] as const;
export type ExerciseMeasure = (typeof EXERCISE_MEASURES)[number];

export const EXERCISE_MEASURE_DISPLAY_NAMES: Record<ExerciseMeasure, string> = {
  weight: "Weight x reps",
  time: "Time",
  distance: "Distance",
};

/**
 * The canonical muscle-group vocabulary. Superset of the thirteen the custom-exercise screen
 * offers (docs/design/phase2-screen-specs.md #6.1 item 2) plus the finer-grained groups
 * free-exercise-db's `primaryMuscles`/`secondaryMuscles` use, so the ingest adapter can map
 * without lossy collapsing in either direction.
 */
export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "core",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
  "hips",
  "lats",
  "traps",
  "lower_back",
  "neck",
  "abductors",
  "adductors",
  "full_body",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_GROUP_DISPLAY_NAMES: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  core: "Core",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
  hips: "Hips",
  lats: "Lats",
  traps: "Traps",
  lower_back: "Lower Back",
  neck: "Neck",
  abductors: "Abductors",
  adductors: "Adductors",
  full_body: "Full Body",
};

/**
 * The canonical equipment vocabulary. Superset of the twelve the custom-exercise screen
 * offers (docs/design/phase2-screen-specs.md #6.1 item 3) plus free-exercise-db's own
 * free-text equipment values, normalized by the ingest adapter (Phase D) rather than passed
 * through — the source field is a single free-text string, not a controlled vocabulary.
 */
export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "cable",
  "band",
  "bodyweight",
  "bench",
  "rack",
  "medicine_ball",
  "trx",
  "sled",
  "foam_roller",
  "exercise_ball",
  "ez_curl_bar",
  "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const EQUIPMENT_DISPLAY_NAMES: Record<Equipment, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  kettlebell: "Kettlebell",
  machine: "Machine",
  cable: "Cable",
  band: "Band",
  bodyweight: "Bodyweight",
  bench: "Bench",
  rack: "Rack",
  medicine_ball: "Medicine Ball",
  trx: "TRX",
  sled: "Sled",
  foam_roller: "Foam Roller",
  exercise_ball: "Exercise Ball",
  ez_curl_bar: "E-Z Curl Bar",
  other: "Other",
};

/**
 * Kept from free-exercise-db as nullable canonical columns rather than adapter metadata
 * (ADR-017) — a custom exercise never sets them, so `Exercise.force`/`level`/`mechanic` are
 * `null` outside the ingested catalogue.
 */
export const FORCES = ["push", "pull", "static"] as const;
export type Force = (typeof FORCES)[number];

export const FORCE_DISPLAY_NAMES: Record<Force, string> = {
  push: "Push",
  pull: "Pull",
  static: "Static",
};

export const LEVELS = ["beginner", "intermediate", "expert"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_DISPLAY_NAMES: Record<Level, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  expert: "Expert",
};

export const MECHANICS = ["compound", "isolation"] as const;
export type Mechanic = (typeof MECHANICS)[number];

export const MECHANIC_DISPLAY_NAMES: Record<Mechanic, string> = {
  compound: "Compound",
  isolation: "Isolation",
};

/**
 * The canonical exercise model (ADR-017). One shape for both catalogue and custom exercises
 * — `ownerUserId: null` marks a catalogue row, matching `exercises.owner_user_id` being a
 * nullable FK rather than a separate table. Not a Postgres row: repositories map `text[]`
 * columns and nullable `text` columns into this interface, same as `Profile` in ./index.ts.
 */
export interface Exercise {
  id: string;
  /** `null` for the ingested catalogue; the owning user's id for a custom exercise. */
  ownerUserId: string | null;
  name: string;
  slug: string;
  category: ExerciseCategory;
  goal: ExerciseGoal;
  measure: ExerciseMeasure;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment[];
  /** Free-exercise-db-specific; `null` for a custom exercise, which has no source data for these. */
  force: Force | null;
  level: Level | null;
  mechanic: Mechanic | null;
  instructions: string[];
  /**
   * Storage keys, never URLs (ADR-018) — resolved to URLs at the API's read boundary through
   * a configurable media base URL, so a media-source change is a config change, not a
   * migration or a contract break.
   */
  imageKeys: string[];
  description: string | null;
  /** `null` for a custom exercise; the adapter's identifier (e.g. "free-exercise-db") otherwise. */
  source: string | null;
  /** The source dataset's own id for this exercise, e.g. free-exercise-db's `id` field. */
  sourceId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
