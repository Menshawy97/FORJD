/**
 * Every closed exercise-vocabulary tuple in ./index.ts must have a matching entry in its
 * *DisplayName map — this test is the enforcement, not documentation of intent. Written
 * before the tuples exist (Phase B, RED first) per the standing TDD rule.
 */
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_DISPLAY_NAMES,
  EQUIPMENT,
  EQUIPMENT_DISPLAY_NAMES,
  EXERCISE_CATEGORIES,
  EXERCISE_CATEGORY_DISPLAY_NAMES,
  EXERCISE_GOALS,
  EXERCISE_GOAL_DISPLAY_NAMES,
  EXERCISE_MEASURES,
  EXERCISE_MEASURE_DISPLAY_NAMES,
  FORCES,
  FORCE_DISPLAY_NAMES,
  LEVELS,
  LEVEL_DISPLAY_NAMES,
  MECHANICS,
  MECHANIC_DISPLAY_NAMES,
} from "./index";

describe("exercise vocabulary display-name coverage", () => {
  const cases: Array<[string, readonly string[], Record<string, string>]> = [
    ["MUSCLE_GROUPS", MUSCLE_GROUPS, MUSCLE_GROUP_DISPLAY_NAMES],
    ["EQUIPMENT", EQUIPMENT, EQUIPMENT_DISPLAY_NAMES],
    ["EXERCISE_CATEGORIES", EXERCISE_CATEGORIES, EXERCISE_CATEGORY_DISPLAY_NAMES],
    ["EXERCISE_GOALS", EXERCISE_GOALS, EXERCISE_GOAL_DISPLAY_NAMES],
    ["EXERCISE_MEASURES", EXERCISE_MEASURES, EXERCISE_MEASURE_DISPLAY_NAMES],
    ["FORCES", FORCES, FORCE_DISPLAY_NAMES],
    ["LEVELS", LEVELS, LEVEL_DISPLAY_NAMES],
    ["MECHANICS", MECHANICS, MECHANIC_DISPLAY_NAMES],
  ];

  it.each(cases)("every %s member has a non-empty display name", (_label, tuple, map) => {
    for (const member of tuple) {
      const name = map[member];
      expect(name).toBeDefined();
      expect(typeof name).toBe("string");
      expect((name ?? "").length).toBeGreaterThan(0);
    }
  });

  it.each(cases)("%s display-name map has no orphan keys", (_label, tuple, map) => {
    const known = new Set<string>(tuple);
    for (const key of Object.keys(map)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("EXERCISE_CATEGORIES matches the design's chip order exactly", () => {
    expect(EXERCISE_CATEGORIES).toEqual([
      "strength",
      "running",
      "cross_training",
      "yoga",
      "calisthenics",
      "mobility",
    ]);
  });
});
