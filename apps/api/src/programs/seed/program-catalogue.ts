import { Activity, ProgramCategory, ProgramLevel } from "@forjd/domain";

/**
 * The nine preset programs, verbatim from the design.
 *
 * Metadata (name, category, `4 days · 8 weeks`, description, level) comes from the prototype's
 * `programList()` / `s_catalog`'s `progs` array; each program's workouts and their exercises
 * come from `workoutsForProgram()`'s own table. **Nothing here is authored.** The Train hero
 * card advertises "24 structured programs"; the design specifies nine, and inventing fifteen
 * more would mean writing training progressions and labelling them `5/3/1` -- fabricated
 * training advice, which this project has consistently refused. K5 corrects that copy instead.
 *
 * `daysPerWeek` and `durationWeeks` are the two halves of the design's meta line stored as
 * numbers rather than as the rendered string, so the screen formats it and the API does not.
 */

/**
 * The curated `prototype name -> catalogue slug` map, with **no fuzzy fallback**.
 *
 * Only 4 of the 28 prototype exercise names match the ingested catalogue exactly, and a
 * shortest-substring match is confidently wrong: it resolves `Bench Press` to *Machine* Bench
 * Press inside a 5/3/1 Bench Day, `Walking Lunge` to `Lunge Sprint` (a different exercise
 * entirely), `Dips` to `Ring Dips` (a much harder variation) and `Lat Pulldown` to an arbitrary
 * grip. Each entry below is the *canonical* form of the movement -- a barbell bench rather than
 * `bench-press-with-bands`, a parallel-bar dip rather than `bench-dips`.
 *
 * Four names have no catalogue equivalent at all and are curated additions instead; see
 * `curated-exercises.ts`. Their slugs appear here too, so this map is the single answer to the
 * question "what does this name resolve to".
 *
 * `program-catalogue.spec.ts` fails if any of these stops resolving against the committed
 * catalogue snapshot -- the catalogue is re-ingested, and an upstream rename would otherwise
 * silently hollow out a program.
 */
export const EXERCISE_SLUG_BY_NAME: Readonly<Record<string, string>> = {
  "Bench Press": "barbell-bench-press-medium-grip",
  "Barbell Row": "bent-over-barbell-row",
  "Overhead Press": "standing-military-press",
  "Lat Pulldown": "wide-grip-lat-pulldown",
  "Back Squat": "barbell-squat",
  "Romanian Deadlift": "romanian-deadlift",
  "Leg Press": "leg-press",
  "Incline DB Press": "incline-dumbbell-press",
  "Pull-up": "pullups",
  "Cable Fly": "cable-crossover",
  Deadlift: "barbell-deadlift",
  "Walking Lunge": "barbell-walking-lunge",
  "Leg Curl": "lying-leg-curls",
  "Triceps Pushdown": "triceps-pushdown",
  "Bicep Curl": "barbell-curl",
  "Calf Raise": "standing-calf-raises",
  Dips: "parallel-bar-dip",
  "Lateral Raise": "side-lateral-raise",
  "Cable Row": "seated-cable-rows",
  "Face Pull": "face-pull",
  "Front Squat": "front-squat-clean-grip",
  "Ab Wheel": "ab-roller",
  "Back Extension": "hyperextensions-back-extensions",
  Thruster: "kettlebell-thruster",
  // Curated additions -- see curated-exercises.ts for why each is not a mapping.
  "5K Run": "5k-run",
  "Tempo Intervals": "tempo-intervals",
  "Assault Bike": "assault-bike",
  "Pistol Squat": "pistol-squat",
};

/**
 * Every seeded workout prescribes **3 sets and no rep target**, which is the design's own choice
 * rather than one made here: `s_programOverview` renders each exercise as
 * `goalOf(n) + ' · 3 sets'`, and `buildSession` starts a program workout with
 * `sessionEx(n, 3, null)`. A rep target would have to be authored, and would be training advice
 * the design never gives.
 */
export const PRESET_SET_COUNT = 3;

export interface SeedProgramWorkout {
  name: string;
  /**
   * Declared per workout rather than derived from the program's category, because a program can
   * mix them -- Hybrid Athlete's "Strength A" is `strength` and its "Long Run" is `running`.
   */
  activity: Activity;
  /** Prototype exercise names, in order. Resolved through `EXERCISE_SLUG_BY_NAME`. */
  exercises: readonly string[];
}

export interface SeedProgram {
  slug: string;
  name: string;
  category: ProgramCategory;
  level: ProgramLevel;
  daysPerWeek: number;
  durationWeeks: number;
  description: string;
  /**
   * Bumped by hand when this program's content changes, and written by the seed on every run.
   * An enrolment snapshots the version it began under (`program_enrollments.program_version`),
   * so a content change is visible as a version change rather than happening invisibly. A re-run
   * that changes nothing writes the same number back, so a deploy does not churn versions.
   */
  version: number;
  workouts: readonly SeedProgramWorkout[];
}

export const SEED_PROGRAMS: readonly SeedProgram[] = [
  {
    slug: "upper-lower",
    name: "Upper / Lower",
    category: "strength",
    level: "intermediate",
    daysPerWeek: 4,
    durationWeeks: 8,
    description: "Balanced strength for 3–5 sessions a week",
    version: 1,
    workouts: [
      {
        name: "Upper Body A",
        activity: "strength",
        exercises: ["Bench Press", "Barbell Row", "Overhead Press", "Lat Pulldown"],
      },
      {
        name: "Lower Body A",
        activity: "strength",
        exercises: ["Back Squat", "Romanian Deadlift", "Leg Press"],
      },
      {
        name: "Upper Body B",
        activity: "strength",
        exercises: ["Incline DB Press", "Pull-up", "Cable Fly"],
      },
      {
        name: "Lower Body B",
        activity: "strength",
        exercises: ["Deadlift", "Walking Lunge", "Leg Curl"],
      },
    ],
  },
  {
    slug: "push-pull-legs",
    name: "Push Pull Legs",
    category: "strength",
    level: "advanced",
    daysPerWeek: 6,
    durationWeeks: 10,
    description: "High frequency, high volume hypertrophy",
    version: 1,
    workouts: [
      {
        name: "Push A",
        activity: "strength",
        exercises: ["Bench Press", "Overhead Press", "Triceps Pushdown"],
      },
      { name: "Pull A", activity: "strength", exercises: ["Deadlift", "Barbell Row", "Bicep Curl"] },
      { name: "Legs A", activity: "strength", exercises: ["Back Squat", "Leg Press", "Calf Raise"] },
      {
        name: "Push B",
        activity: "strength",
        exercises: ["Incline DB Press", "Dips", "Lateral Raise"],
      },
      { name: "Pull B", activity: "strength", exercises: ["Pull-up", "Cable Row", "Face Pull"] },
      {
        name: "Legs B",
        activity: "strength",
        exercises: ["Front Squat", "Leg Curl", "Walking Lunge"],
      },
    ],
  },
  {
    slug: "full-body-foundations",
    name: "Full Body Foundations",
    category: "strength",
    level: "beginner",
    daysPerWeek: 3,
    durationWeeks: 6,
    description: "Time-efficient, pairs well with running",
    version: 1,
    workouts: [
      {
        name: "Full Body A",
        activity: "strength",
        exercises: ["Back Squat", "Bench Press", "Barbell Row"],
      },
      {
        name: "Full Body B",
        activity: "strength",
        exercises: ["Deadlift", "Overhead Press", "Pull-up"],
      },
      {
        name: "Full Body C",
        activity: "strength",
        exercises: ["Front Squat", "Incline DB Press", "Cable Row"],
      },
    ],
  },
  {
    slug: "531-progression",
    name: "5/3/1 Progression",
    category: "strength",
    level: "intermediate",
    daysPerWeek: 4,
    durationWeeks: 12,
    description: "Percentage-based barbell progression",
    version: 1,
    workouts: [
      { name: "Squat Day", activity: "strength", exercises: ["Back Squat", "Leg Press", "Ab Wheel"] },
      {
        name: "Bench Day",
        activity: "strength",
        exercises: ["Bench Press", "Incline DB Press", "Triceps Pushdown"],
      },
      {
        name: "Deadlift Day",
        activity: "strength",
        exercises: ["Deadlift", "Barbell Row", "Back Extension"],
      },
      {
        name: "Overhead Press Day",
        activity: "strength",
        exercises: ["Overhead Press", "Lateral Raise", "Dips"],
      },
    ],
  },
  {
    slug: "hybrid-athlete",
    name: "Hybrid Athlete",
    category: "hybrid",
    level: "intermediate",
    daysPerWeek: 5,
    durationWeeks: 10,
    description: "Lift heavy, run far, in the same week",
    version: 1,
    workouts: [
      {
        name: "Strength A",
        activity: "strength",
        exercises: ["Back Squat", "Bench Press", "Barbell Row"],
      },
      { name: "Tempo Run", activity: "running", exercises: ["5K Run"] },
      {
        name: "Strength B",
        activity: "strength",
        exercises: ["Deadlift", "Overhead Press", "Pull-up"],
      },
      { name: "Intervals", activity: "running", exercises: ["Tempo Intervals"] },
      { name: "Long Run", activity: "running", exercises: ["5K Run"] },
    ],
  },
  {
    slug: "race-prep-10k",
    name: "Race Prep 10K",
    category: "running",
    level: "intermediate",
    daysPerWeek: 4,
    durationWeeks: 8,
    description: "Threshold, intervals, long run",
    version: 1,
    workouts: [
      { name: "Threshold Run", activity: "running", exercises: ["Tempo Intervals"] },
      { name: "Interval Repeats", activity: "running", exercises: ["Tempo Intervals"] },
      { name: "Easy Run", activity: "running", exercises: ["5K Run"] },
      { name: "Long Run", activity: "running", exercises: ["5K Run"] },
    ],
  },
  {
    slug: "couch-to-5k",
    name: "Couch to 5K",
    category: "running",
    level: "beginner",
    daysPerWeek: 3,
    durationWeeks: 9,
    description: "Walk-run build for a first 5K",
    version: 1,
    workouts: [
      { name: "Walk-Run A", activity: "running", exercises: ["5K Run"] },
      { name: "Walk-Run B", activity: "running", exercises: ["5K Run"] },
      { name: "Walk-Run C", activity: "running", exercises: ["5K Run"] },
    ],
  },
  {
    slug: "engine-builder",
    name: "Engine Builder",
    category: "cross_training",
    level: "intermediate",
    daysPerWeek: 5,
    durationWeeks: 6,
    description: "Conditioning circuits and machine intervals",
    version: 1,
    workouts: [
      { name: "Conditioning A", activity: "cross_training", exercises: ["Assault Bike", "Thruster"] },
      { name: "Conditioning B", activity: "cross_training", exercises: ["Thruster", "Assault Bike"] },
      { name: "Conditioning C", activity: "cross_training", exercises: ["Assault Bike", "Thruster"] },
      { name: "Conditioning D", activity: "cross_training", exercises: ["Thruster", "Assault Bike"] },
      { name: "Conditioning E", activity: "cross_training", exercises: ["Assault Bike", "Thruster"] },
    ],
  },
  {
    slug: "bodyweight-anywhere",
    name: "Bodyweight Anywhere",
    category: "cross_training",
    level: "beginner",
    daysPerWeek: 4,
    durationWeeks: 6,
    description: "No equipment, progressive calisthenics",
    version: 1,
    workouts: [
      { name: "Full Body A", activity: "cross_training", exercises: ["Pull-up", "Pistol Squat"] },
      { name: "Full Body B", activity: "cross_training", exercises: ["Pistol Squat", "Pull-up"] },
      { name: "Full Body C", activity: "cross_training", exercises: ["Pull-up", "Pistol Squat"] },
      { name: "Full Body D", activity: "cross_training", exercises: ["Pistol Squat", "Pull-up"] },
    ],
  },
];
