import { readFileSync } from "fs";

import { ACTIVITIES, PROGRAM_CATEGORIES, PROGRAM_LEVELS } from "@forjd/domain";

import { SNAPSHOT_PATH, parseSnapshot } from "../../exercises/ingest/load";
import { CURATED_EXERCISES } from "./curated-exercises";
import { EXERCISE_SLUG_BY_NAME, SEED_PROGRAMS } from "./program-catalogue";

/**
 * The guard the whole seed rests on.
 *
 * `EXERCISE_SLUG_BY_NAME` is hand-curated with no fuzzy fallback, which is the right choice --
 * fuzzy matching resolved `Bench Press` to a *machine* press and `Walking Lunge` to `Lunge
 * Sprint`, and being confidently wrong is worse than failing. But a hand-curated map against a
 * dataset that gets re-vendored is exactly the thing that rots silently: upstream renames
 * `pullups`, the seed then fails on a deploy or, worse, a later well-meaning fuzzy fallback
 * papers over it, and nobody finds out until a program shows up in the app missing a lift.
 *
 * So this runs in CI, needs no database, and reads the same committed snapshot the loader does.
 * A rename upstream becomes a red build with the offending name printed, next to the re-vendor
 * diff that explains it.
 */
describe("program catalogue seed data", () => {
  const snapshot = parseSnapshot(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as unknown);

  const ingestedSlugs = new Set(snapshot.map((exercise) => exercise.slug));
  const curatedSlugs = new Set(CURATED_EXERCISES.map((exercise) => exercise.slug));
  const resolvableSlugs = new Set([...ingestedSlugs, ...curatedSlugs]);

  const namesUsedByPrograms = new Set(
    SEED_PROGRAMS.flatMap((program) => program.workouts.flatMap((workout) => workout.exercises)),
  );

  /** The test the phase plan asks for by name. */
  it("resolves every mapped exercise name to a real catalogue slug", () => {
    const unresolved = Object.entries(EXERCISE_SLUG_BY_NAME)
      .filter(([, slug]) => !resolvableSlugs.has(slug))
      .map(([name, slug]) => `${name} -> ${slug}`);

    expect(unresolved).toEqual([]);
  });

  it("uses only names the map knows -- no program references an unmapped exercise", () => {
    const unmapped = [...namesUsedByPrograms].filter((name) => !(name in EXERCISE_SLUG_BY_NAME));

    expect(unmapped).toEqual([]);
  });

  /**
   * The other direction. A mapping nothing uses is a mapping nobody re-checks, and it would keep
   * this suite green while describing a catalogue that has moved on.
   */
  it("has no mapping that no program uses", () => {
    const unused = Object.keys(EXERCISE_SLUG_BY_NAME).filter(
      (name) => !namesUsedByPrograms.has(name),
    );

    expect(unused).toEqual([]);
  });

  /**
   * A curated addition exists *because* the ingested catalogue has no equivalent. If a re-vendor
   * ever ships one of these slugs, the curated row stops being an addition and becomes a
   * duplicate competing for the same slug -- which the seed should not paper over.
   */
  it("keeps curated additions distinct from anything the ingested catalogue supplies", () => {
    const collisions = [...curatedSlugs].filter((slug) => ingestedSlugs.has(slug));

    expect(collisions).toEqual([]);
  });

  it("maps the four names the ingested catalogue genuinely cannot supply to curated rows", () => {
    // Named explicitly rather than derived, so quietly dropping a curated exercise and
    // re-pointing its name at some plausible ingested row fails here instead of passing.
    expect(
      ["5K Run", "Tempo Intervals", "Assault Bike", "Pistol Squat"].map(
        (name) => EXERCISE_SLUG_BY_NAME[name],
      ),
    ).toEqual(["5k-run", "tempo-intervals", "assault-bike", "pistol-squat"]);

    expect([...curatedSlugs].sort()).toEqual([
      "5k-run",
      "assault-bike",
      "pistol-squat",
      "tempo-intervals",
    ]);
  });

  /**
   * The specific mismapping this phase was corrected for. `air-bike` in free-exercise-db is the
   * bicycle crunch -- a core exercise -- not the fan bike, and an earlier draft of the plan said
   * to map `Assault Bike` onto it. Pinned as a test rather than only as prose, because prose in
   * a plan document does not fail a build.
   */
  it("never maps Assault Bike onto air-bike, which is the bicycle crunch", () => {
    expect(Object.values(EXERCISE_SLUG_BY_NAME)).not.toContain("air-bike");

    const airBike = snapshot.find((exercise) => exercise.slug === "air-bike");
    expect(airBike?.primaryMuscles).toEqual(["core"]);
  });

  describe("the nine programs", () => {
    it("seeds exactly the nine the design specifies, with unique slugs and names", () => {
      expect(SEED_PROGRAMS).toHaveLength(9);
      expect(new Set(SEED_PROGRAMS.map((program) => program.slug)).size).toBe(9);
      expect(new Set(SEED_PROGRAMS.map((program) => program.name)).size).toBe(9);
    });

    it.each(SEED_PROGRAMS.map((program) => [program.slug, program] as const))(
      "%s uses only canonical vocabulary and prescribes one workout per training day",
      (_slug, program) => {
        expect(PROGRAM_CATEGORIES).toContain(program.category);
        expect(PROGRAM_LEVELS).toContain(program.level);
        expect(program.durationWeeks).toBeGreaterThan(0);
        expect(program.version).toBeGreaterThanOrEqual(1);

        // The design's meta line and its workout table have to agree: "4 days · 8 weeks" beside
        // three workouts would show the athlete a week it cannot fill.
        expect(program.workouts).toHaveLength(program.daysPerWeek);

        for (const workout of program.workouts) {
          expect(ACTIVITIES).toContain(workout.activity);
          expect(workout.exercises.length).toBeGreaterThan(0);
        }

        // A duplicate workout name inside one program would be unreadable in the overview list,
        // where the name is all that distinguishes one row from the next.
        expect(new Set(program.workouts.map((workout) => workout.name)).size).toBe(
          program.workouts.length,
        );
      },
    );
  });
});
