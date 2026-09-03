import { NormalizedExercise } from "../../exercises/ingest/exercise-source-adapter.interface";

/**
 * The four exercises Phase K's programs need and the ingested catalogue genuinely does not have.
 *
 * free-exercise-db is a *resistance-training* database. Three of the nine seeded programs (Race
 * Prep 10K, Couch to 5K, and half of Hybrid Athlete) are built almost entirely on running, and
 * two more reach for movements the dataset only offers in a form that contradicts the program
 * using it. Fuzzy-matching them would be confidently wrong -- the failure mode
 * `docs/product/phase-3k-plan.md` exists to prevent -- so these four are curated additions:
 *
 * - **5K Run** and **Tempo Intervals**: no running or interval exercise exists at all.
 * - **Assault Bike**: `air-bike` in free-exercise-db is the *bicycle crunch* (`strength`, core,
 *   bodyweight), not the fan bike. Mapping it would have put an abdominal crunch into Engine
 *   Builder's conditioning days.
 * - **Pistol Squat**: the catalogue offers only `kettlebell-pistol-squat` and
 *   `smith-machine-pistol-squat`, and both contradict "Bodyweight Anywhere", whose whole
 *   premise is no equipment.
 *
 * **Nothing here is invented training advice.** `category` and `goal` come from the design's own
 * `libraryAll()` table in `FORJD Mobile.dc.html`, which already lists all four with exactly
 * these values ("Running / Muscular endurance", "Cross Training / Muscular endurance",
 * "Calisthenics / Power"); `measure` follows from what the movement is counted in.
 *
 * **A distinct `source`.** These upsert through the same `(source, source_id)` partial unique
 * index the ingested rows use, so re-running the seed can never duplicate them, and the source
 * value keeps them distinguishable -- a re-vendor of free-exercise-db rewrites its own rows and
 * leaves these alone.
 */
export const CURATED_EXERCISE_SOURCE = "forjd-curated";

/**
 * Typed as `NormalizedExercise` so these travel the exact path an ingested exercise does --
 * `ExercisesRepository.upsertCatalogueExercise` -- rather than a second, less-tested write path
 * free to disagree with it about defaults.
 */
export const CURATED_EXERCISES: readonly NormalizedExercise[] = [
  {
    source: CURATED_EXERCISE_SOURCE,
    sourceId: "5k-run",
    name: "5K Run",
    slug: "5k-run",
    category: "running",
    goal: "muscular_endurance",
    // Distance, not time: the five kilometres are the prescription, the time is the result.
    measure: "distance",
    primaryMuscles: ["quads", "hamstrings", "calves"],
    secondaryMuscles: ["glutes", "core"],
    equipment: [],
    force: null,
    level: "beginner",
    mechanic: "compound",
    instructions: [
      "Start with five to ten minutes of easy jogging to warm up.",
      "Settle into a pace you could hold a conversation at, unless the session prescribes otherwise.",
      "Cover five kilometres, keeping the effort even rather than starting fast and fading.",
      "Finish with five minutes of walking or very easy jogging to cool down.",
    ],
    imageKeys: [],
    description: null,
  },
  {
    source: CURATED_EXERCISE_SOURCE,
    sourceId: "tempo-intervals",
    name: "Tempo Intervals",
    slug: "tempo-intervals",
    category: "running",
    goal: "muscular_endurance",
    // Time: an interval is prescribed in minutes of work, not as a fixed distance.
    measure: "time",
    primaryMuscles: ["quads", "hamstrings", "calves"],
    secondaryMuscles: ["glutes", "core"],
    equipment: [],
    force: null,
    level: "intermediate",
    mechanic: "compound",
    instructions: [
      "Warm up with ten minutes of easy running.",
      "Run at a comfortably hard effort -- around the pace you could hold for an hour -- for the prescribed interval.",
      "Recover with easy jogging between intervals until your breathing settles.",
      "Repeat for the prescribed number of intervals, then cool down with easy running.",
    ],
    imageKeys: [],
    description: null,
  },
  {
    source: CURATED_EXERCISE_SOURCE,
    sourceId: "assault-bike",
    name: "Assault Bike",
    slug: "assault-bike",
    category: "cross_training",
    goal: "muscular_endurance",
    measure: "time",
    primaryMuscles: ["quads", "hamstrings"],
    secondaryMuscles: ["shoulders", "back", "core"],
    equipment: ["machine"],
    force: null,
    level: "beginner",
    mechanic: "compound",
    instructions: [
      "Set the seat so the leg is almost straight at the bottom of the pedal stroke.",
      "Drive with the legs and push and pull the handles together, rather than letting the arms ride along.",
      "Hold the prescribed effort for the working interval -- the fan makes the resistance rise with your own output.",
      "Pedal easily between intervals rather than stopping dead.",
    ],
    imageKeys: [],
    description: null,
  },
  {
    source: CURATED_EXERCISE_SOURCE,
    sourceId: "pistol-squat",
    name: "Pistol Squat",
    slug: "pistol-squat",
    category: "calisthenics",
    goal: "power",
    measure: "weight",
    primaryMuscles: ["quads", "glutes"],
    secondaryMuscles: ["hamstrings", "calves", "core"],
    equipment: ["bodyweight"],
    force: "push",
    // `LEVELS` reads beginner | intermediate | expert -- it has no `advanced`, which belongs to
    // `PROGRAM_LEVELS` and means something else.
    level: "expert",
    mechanic: "compound",
    instructions: [
      "Stand on one leg with the other extended in front of you and the arms out for balance.",
      "Sit back and down on the standing leg, keeping the heel flat and the extended leg clear of the floor.",
      "Descend as far as you can control, ideally until the back of the thigh meets the calf.",
      "Drive through the standing heel to stand back up without letting the free foot touch down.",
    ],
    imageKeys: [],
    description: null,
  },
];
