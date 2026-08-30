import { readFileSync } from "fs";
import { join } from "path";

import { FreeExerciseDbAdapter, FreeExerciseDbRow } from "./free-exercise-db.adapter";
import { ExerciseOverrides } from "./exercise-source-adapter.interface";

/**
 * Golden-fixture tests on the normalizer (CLAUDE.md rule 8, Phase D of
 * `docs/product/phase-2-plan.md`).
 *
 * The adapter is deliberately pure -- it takes the raw rows and the override table as
 * constructor arguments and does no I/O. Reading the dataset and the override file is the
 * `exercises:normalize` script's job. That split is what lets these tests state an exact
 * expected record for a hand-picked input instead of asserting loosely against 873 rows,
 * and it keeps a filesystem path out of the code Phase E will call at load time.
 *
 * "Covering every source category and each exercise an override exists for" is the plan's
 * wording, and both halves are enforced mechanically below rather than trusted to whoever
 * adds the next case.
 */

const DATASET_PATH = join(__dirname, "data", "free-exercise-db.json");
const OVERRIDES_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "domain",
  "data",
  "exercise-overrides.json",
);

const realRows = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as FreeExerciseDbRow[];
const realOverrides = (
  JSON.parse(readFileSync(OVERRIDES_PATH, "utf8")) as { overrides: ExerciseOverrides }
).overrides;

/** Every distinct `category` free-exercise-db uses at the pinned commit. See SOURCE.md. */
const SOURCE_CATEGORIES = [
  "strength",
  "stretching",
  "plyometrics",
  "powerlifting",
  "olympic weightlifting",
  "strongman",
  "cardio",
] as const;

const rowById = (id: string): FreeExerciseDbRow => {
  const row = realRows.find((candidate) => candidate.id === id);
  if (!row) {
    throw new Error(`fixture drift: no exercise with id "${id}" in the pinned dataset`);
  }
  return row;
};

/** Normalizes the real dataset through the real override file -- the production path. */
const normalizeReal = () => new FreeExerciseDbAdapter(realRows, realOverrides).normalizeAll();

const findNormalized = (sourceId: string) => {
  const match = normalizeReal().find((exercise) => exercise.sourceId === sourceId);
  if (!match) {
    throw new Error(`no normalized output for source id "${sourceId}"`);
  }
  return match;
};

describe("FreeExerciseDbAdapter", () => {
  describe("source identity", () => {
    it('reports "free-exercise-db" as its source, and stamps it on every record', () => {
      const adapter = new FreeExerciseDbAdapter(realRows, {});
      expect(adapter.source).toBe("free-exercise-db");
      expect(adapter.normalizeAll().every((e) => e.source === "free-exercise-db")).toBe(true);
    });

    it("carries the source's own id through to sourceId, unmodified", () => {
      expect(findNormalized("3_4_Sit-Up").sourceId).toBe("3_4_Sit-Up");
    });
  });

  describe("golden fixture: a fully-populated strength exercise", () => {
    it("normalizes 3/4 Sit-Up exactly", () => {
      expect(findNormalized("3_4_Sit-Up")).toEqual({
        source: "free-exercise-db",
        sourceId: "3_4_Sit-Up",
        name: "3/4 Sit-Up",
        slug: "3-4-sit-up",
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["core"],
        secondaryMuscles: [],
        equipment: ["bodyweight"],
        force: "pull",
        level: "beginner",
        mechanic: "compound",
        instructions: rowById("3_4_Sit-Up").instructions,
        imageKeys: ["3_4_Sit-Up/0.jpg", "3_4_Sit-Up/1.jpg"],
        description: null,
      });
    });
  });

  describe("category mapping -- every source category is covered", () => {
    it.each([
      ["strength", "Barbell_Bench_Press_-_Medium_Grip", "strength"],
      ["powerlifting", "Bench_Press_-_Powerlifting", "strength"],
      ["olympic weightlifting", "Clean", "strength"],
      ["strongman", "Atlas_Stones", "strength"],
      ["stretching", "All_Fours_Quad_Stretch", "mobility"],
      ["plyometrics", "Bench_Jump", "cross_training"],
      ["cardio", "Bicycling", "cross_training"],
    ])("maps source category %s to canonical %s", (sourceCategory, sourceId, expected) => {
      expect(rowById(sourceId).category).toBe(sourceCategory);
      expect(findNormalized(sourceId).category).toBe(expected);
    });

    it("throws on a source category it has no rule for, rather than guessing", () => {
      const rogue = { ...rowById("3_4_Sit-Up"), id: "rogue", category: "aquatics" };
      expect(() => new FreeExerciseDbAdapter([rogue], {}).normalizeAll()).toThrow(
        /unmapped source category "aquatics"/i,
      );
    });
  });

  describe("goal derivation -- from category, then mechanic", () => {
    it.each([
      ["Barbell_Bench_Press_-_Medium_Grip", "strength"],
      ["Bench_Press_-_Powerlifting", "strength"],
      ["Clean", "power"],
      ["Atlas_Stones", "power"],
      ["Bench_Jump", "power"],
      ["All_Fours_Quad_Stretch", "mobility"],
      ["Bicycling", "muscular_endurance"],
    ])("derives %s -> goal %s", (sourceId, expected) => {
      expect(findNormalized(sourceId).goal).toBe(expected);
    });

    it("derives hypertrophy for an isolation lift in the strength category", () => {
      const row = { ...rowById("3_4_Sit-Up"), id: "iso", mechanic: "isolation" as const };
      expect(new FreeExerciseDbAdapter([row], {}).normalizeAll()[0]?.goal).toBe("hypertrophy");
    });

    it("falls back to strength when a strength lift has no mechanic recorded", () => {
      const row = { ...rowById("3_4_Sit-Up"), id: "nomech", mechanic: null };
      expect(new FreeExerciseDbAdapter([row], {}).normalizeAll()[0]?.goal).toBe("strength");
    });
  });

  describe("measure derivation", () => {
    it.each([
      ["3_4_Sit-Up", "weight"],
      ["Barbell_Bench_Press_-_Medium_Grip", "weight"],
      ["Bench_Jump", "weight"],
      ["All_Fours_Quad_Stretch", "time"],
      ["Bicycling", "distance"],
    ])("derives %s -> measure %s", (sourceId, expected) => {
      expect(findNormalized(sourceId).measure).toBe(expected);
    });
  });

  describe("equipment mapping", () => {
    it.each([
      ["body only", "bodyweight"],
      ["barbell", "barbell"],
      ["dumbbell", "dumbbell"],
      ["kettlebells", "kettlebell"],
      ["machine", "machine"],
      ["cable", "cable"],
      ["bands", "band"],
      ["medicine ball", "medicine_ball"],
      ["exercise ball", "exercise_ball"],
      ["e-z curl bar", "ez_curl_bar"],
      ["foam roll", "foam_roller"],
      ["other", "other"],
    ])("maps free-text %s to canonical %s", (sourceEquipment, expected) => {
      const row = { ...rowById("3_4_Sit-Up"), id: "eq", equipment: sourceEquipment };
      expect(new FreeExerciseDbAdapter([row], {}).normalizeAll()[0]?.equipment).toEqual([expected]);
    });

    it("covers every equipment value the pinned dataset actually contains", () => {
      const sourceValues = new Set(
        realRows.map((row) => row.equipment).filter((value): value is string => value !== null),
      );
      // If a re-vendor introduces a new free-text value, this fails here rather than at
      // normalize time -- and the table above is the thing to extend.
      expect(() => new FreeExerciseDbAdapter(realRows, {}).normalizeAll()).not.toThrow();
      expect(sourceValues.size).toBe(12);
    });

    it("yields an empty array when the source records no equipment, never a guess", () => {
      const row = { ...rowById("3_4_Sit-Up"), id: "noeq", equipment: null };
      expect(new FreeExerciseDbAdapter([row], {}).normalizeAll()[0]?.equipment).toEqual([]);
    });

    it("throws on an unmapped equipment value rather than dropping it silently", () => {
      const row = { ...rowById("3_4_Sit-Up"), id: "weird", equipment: "jetpack" };
      expect(() => new FreeExerciseDbAdapter([row], {}).normalizeAll()).toThrow(
        /unmapped source equipment "jetpack"/i,
      );
    });
  });

  describe("muscle mapping", () => {
    it.each([
      ["abdominals", "core"],
      ["quadriceps", "quads"],
      ["middle back", "back"],
      ["lower back", "lower_back"],
      ["hamstrings", "hamstrings"],
      ["lats", "lats"],
      ["traps", "traps"],
      ["neck", "neck"],
      ["abductors", "abductors"],
      ["adductors", "adductors"],
      ["biceps", "biceps"],
      ["triceps", "triceps"],
      ["chest", "chest"],
      ["shoulders", "shoulders"],
      ["forearms", "forearms"],
      ["glutes", "glutes"],
      ["calves", "calves"],
    ])("maps source muscle %s to canonical %s", (sourceMuscle, expected) => {
      const row = {
        ...rowById("3_4_Sit-Up"),
        id: "m",
        primaryMuscles: [sourceMuscle],
        secondaryMuscles: [sourceMuscle],
      };
      const normalized = new FreeExerciseDbAdapter([row], {}).normalizeAll()[0];
      expect(normalized?.primaryMuscles).toEqual([expected]);
      expect(normalized?.secondaryMuscles).toEqual([expected]);
    });

    it("throws on an unmapped muscle rather than dropping it silently", () => {
      const row = { ...rowById("3_4_Sit-Up"), id: "m2", primaryMuscles: ["gills"] };
      expect(() => new FreeExerciseDbAdapter([row], {}).normalizeAll()).toThrow(
        /unmapped source muscle "gills"/i,
      );
    });
  });

  describe("pass-through fields", () => {
    it("keeps force, level and mechanic as-is when present -- they are already canonical", () => {
      const normalized = findNormalized("3_4_Sit-Up");
      expect([normalized.force, normalized.level, normalized.mechanic]).toEqual([
        "pull",
        "beginner",
        "compound",
      ]);
    });

    it("preserves null force and null mechanic rather than inventing a value", () => {
      const row = { ...rowById("3_4_Sit-Up"), id: "nulls", force: null, mechanic: null };
      const normalized = new FreeExerciseDbAdapter([row], {}).normalizeAll()[0];
      expect(normalized?.force).toBeNull();
      expect(normalized?.mechanic).toBeNull();
    });

    // force/level/mechanic are declared as the canonical types on FreeExerciseDbRow, which is a
    // claim about JSON -- i.e. an assertion, not a guarantee. Without these three the pass-through
    // would be the one field group in the whole adapter that a re-vendor could quietly widen,
    // contradicting the "throw rather than default" rule every other field follows.
    it.each([
      ["force", { force: "sideways" }, /unmapped source force "sideways"/i],
      ["level", { level: "advanced" }, /unmapped source level "advanced"/i],
      ["mechanic", { mechanic: "hybrid" }, /unmapped source mechanic "hybrid"/i],
    ])("throws on an off-vocabulary %s rather than passing it through", (_field, patch, message) => {
      const row = { ...rowById("3_4_Sit-Up"), id: "v", ...patch } as unknown as FreeExerciseDbRow;
      expect(() => new FreeExerciseDbAdapter([row], {}).normalizeAll()).toThrow(message);
    });

    it("accepts a null force and a null mechanic, but not a null level", () => {
      const base = rowById("3_4_Sit-Up");
      expect(() =>
        new FreeExerciseDbAdapter(
          [{ ...base, id: "ok", force: null, mechanic: null }],
          {},
        ).normalizeAll(),
      ).not.toThrow();
      const noLevel = { ...base, id: "bad", level: null } as unknown as FreeExerciseDbRow;
      expect(() => new FreeExerciseDbAdapter([noLevel], {}).normalizeAll()).toThrow(
        /unmapped source level "null"/i,
      );
    });

    it("carries image paths through as storage keys, unmodified (ADR-018)", () => {
      expect(findNormalized("3_4_Sit-Up").imageKeys).toEqual([
        "3_4_Sit-Up/0.jpg",
        "3_4_Sit-Up/1.jpg",
      ]);
    });

    it("sets description to null -- free-exercise-db has no such field", () => {
      expect(normalizeReal().every((e) => e.description === null)).toBe(true);
    });
  });

  describe("slugs", () => {
    it.each([
      ["3/4 Sit-Up", "3-4-sit-up"],
      ["90/90 Hamstring", "90-90-hamstring"],
      ["Barbell Bench Press - Medium Grip", "barbell-bench-press-medium-grip"],
      ["Bench Press - With Bands", "bench-press-with-bands"],
    ])("slugifies %s to %s", (name, expected) => {
      const row = { ...rowById("3_4_Sit-Up"), id: "s", name };
      expect(new FreeExerciseDbAdapter([row], {}).normalizeAll()[0]?.slug).toBe(expected);
    });

    it("produces a unique, non-empty slug for every exercise in the pinned dataset", () => {
      const slugs = normalizeReal().map((e) => e.slug);
      expect(slugs.every((slug) => slug.length > 0)).toBe(true);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it("throws when two exercises would collide on a slug", () => {
      const rows = [
        { ...rowById("3_4_Sit-Up"), id: "a", name: "Sit Up" },
        { ...rowById("3_4_Sit-Up"), id: "b", name: "Sit-Up" },
      ];
      expect(() => new FreeExerciseDbAdapter(rows, {}).normalizeAll()).toThrow(
        /duplicate slug "sit-up"/i,
      );
    });

    it("throws when the source contains a duplicate id", () => {
      const rows = [
        { ...rowById("3_4_Sit-Up"), id: "dupe", name: "One" },
        { ...rowById("3_4_Sit-Up"), id: "dupe", name: "Two" },
      ];
      expect(() => new FreeExerciseDbAdapter(rows, {}).normalizeAll()).toThrow(
        /duplicate source id "dupe"/i,
      );
    });
  });

  describe("overrides", () => {
    it("applies a category override on top of the deterministic mapping", () => {
      const overrides: ExerciseOverrides = { Bicycling: { category: "running" } };
      const normalized = new FreeExerciseDbAdapter(realRows, overrides).normalizeAll();
      expect(normalized.find((e) => e.sourceId === "Bicycling")?.category).toBe("running");
    });

    it("leaves fields the override does not mention alone", () => {
      const overrides: ExerciseOverrides = { Bicycling: { category: "running" } };
      const normalized = new FreeExerciseDbAdapter(realRows, overrides).normalizeAll();
      const bicycling = normalized.find((e) => e.sourceId === "Bicycling");
      expect(bicycling?.goal).toBe("muscular_endurance");
      expect(bicycling?.measure).toBe("distance");
    });

    it("rejects an override for a source id that is not in the dataset", () => {
      const overrides: ExerciseOverrides = { Not_A_Real_Exercise: { category: "running" } };
      expect(() => new FreeExerciseDbAdapter(realRows, overrides).normalizeAll()).toThrow(
        /override targets unknown source id "Not_A_Real_Exercise"/i,
      );
    });

    it("rejects an override whose value is outside the canonical vocabulary", () => {
      const overrides = { Bicycling: { category: "swimming" } } as unknown as ExerciseOverrides;
      expect(() => new FreeExerciseDbAdapter(realRows, overrides).normalizeAll()).toThrow(
        /invalid override category "swimming"/i,
      );
    });
  });

  describe("the committed override file", () => {
    it("splits the four treadmill/trail entries out of cardio into the running category", () => {
      for (const sourceId of [
        "Jogging_Treadmill",
        "Running_Treadmill",
        "Walking_Treadmill",
        "Trail_Running_Walking",
      ]) {
        const normalized = findNormalized(sourceId);
        expect(normalized.category).toBe("running");
        expect(normalized.measure).toBe("distance");
      }
    });

    it("measures the four fixed-position cardio machines by time, not distance", () => {
      for (const sourceId of ["Rope_Jumping", "Elliptical_Trainer", "Stairmaster", "Step_Mill"]) {
        expect(findNormalized(sourceId).measure).toBe("time");
      }
    });

    it("has a golden-fixture assertion for every id it overrides", () => {
      // The plan requires a test for "each exercise an override exists for". Enforced here so
      // adding an override without a test fails the suite rather than passing unnoticed.
      const covered = new Set([
        "Jogging_Treadmill",
        "Running_Treadmill",
        "Walking_Treadmill",
        "Trail_Running_Walking",
        "Rope_Jumping",
        "Elliptical_Trainer",
        "Stairmaster",
        "Step_Mill",
      ]);
      expect(new Set(Object.keys(realOverrides))).toEqual(covered);
    });
  });

  describe("the pinned dataset as a whole", () => {
    it("normalizes all 873 exercises without throwing", () => {
      expect(normalizeReal()).toHaveLength(873);
    });

    it("covers every source category the dataset contains, with no rule left unused", () => {
      const present = new Set(realRows.map((row) => row.category));
      expect(present).toEqual(new Set(SOURCE_CATEGORIES));
    });

    it("emits only canonical vocabulary values", () => {
      const normalized = normalizeReal();
      expect([...new Set(normalized.map((e) => e.category))].sort()).toEqual([
        "cross_training",
        "mobility",
        "running",
        "strength",
      ]);
      expect([...new Set(normalized.map((e) => e.goal))].sort()).toEqual([
        "hypertrophy",
        "mobility",
        "muscular_endurance",
        "power",
        "strength",
      ]);
      expect([...new Set(normalized.map((e) => e.measure))].sort()).toEqual([
        "distance",
        "time",
        "weight",
      ]);
    });

    it("is deterministic -- normalizing twice produces identical output", () => {
      expect(normalizeReal()).toEqual(normalizeReal());
    });
  });
});
