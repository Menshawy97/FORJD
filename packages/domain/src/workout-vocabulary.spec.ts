/**
 * Every closed workout-vocabulary tuple must have a matching entry in its *DisplayName map,
 * and every tuple whose membership was a deliberate decision is pinned here by value --
 * this test is the enforcement, mirroring exercise-vocabulary.spec.ts's own pattern.
 * Written before the tuples exist (Phase A, RED first) per the standing TDD rule.
 */
import {
  WORKOUT_BLOCK_TYPES,
  WORKOUT_BLOCK_TYPE_DISPLAY_NAMES,
  WORKOUT_SET_TYPES,
  WORKOUT_SET_TYPE_DISPLAY_NAMES,
  WORKOUT_SESSION_STATUSES,
  WORKOUT_SESSION_STATUS_DISPLAY_NAMES,
  PERCEIVED_EFFORTS,
  PERCEIVED_EFFORT_DISPLAY_NAMES,
  WORKOUT_EVENT_TYPES,
  WORKOUT_EVENT_TYPE_DISPLAY_NAMES,
} from "./index";

describe("workout vocabulary display-name coverage", () => {
  const cases: Array<[string, readonly string[], Record<string, string>]> = [
    ["WORKOUT_BLOCK_TYPES", WORKOUT_BLOCK_TYPES, WORKOUT_BLOCK_TYPE_DISPLAY_NAMES],
    ["WORKOUT_SET_TYPES", WORKOUT_SET_TYPES, WORKOUT_SET_TYPE_DISPLAY_NAMES],
    ["WORKOUT_SESSION_STATUSES", WORKOUT_SESSION_STATUSES, WORKOUT_SESSION_STATUS_DISPLAY_NAMES],
    ["PERCEIVED_EFFORTS", PERCEIVED_EFFORTS, PERCEIVED_EFFORT_DISPLAY_NAMES],
    ["WORKOUT_EVENT_TYPES", WORKOUT_EVENT_TYPES, WORKOUT_EVENT_TYPE_DISPLAY_NAMES],
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

  it.each(cases)("%s has no duplicate members", (_label, tuple) => {
    expect(new Set(tuple).size).toBe(tuple.length);
  });

  it.each(cases)("%s members are stable snake_case slugs, not display strings", (_label, tuple) => {
    for (const member of tuple) {
      expect(member).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe("workout vocabulary membership", () => {
  /**
   * The five block types are fixed by docs/architecture/workout-engine.md and re-locked in
   * phase-3-plan.md's locked-decisions table: only straight sets is *implemented* first, but
   * all five ship in the tuple from day one so HYROX, running and Pilates arrive as content
   * rather than as a schema migration. Narrowing this list later is free; discovering it is
   * missing a value after `workout_blocks.type` is populated is not.
   */
  it("WORKOUT_BLOCK_TYPES carries all five types from day one", () => {
    expect(WORKOUT_BLOCK_TYPES).toEqual([
      "straight_sets",
      "superset",
      "interval",
      "amrap",
      "time_based",
    ]);
  });

  /**
   * The seven local event names are quoted verbatim by workout-engine.md's append-only-log
   * section and are what crash recovery replays. They are slugs here rather than the doc's
   * PascalCase because every other stored value set in this package is a slug.
   */
  it("WORKOUT_EVENT_TYPES matches the architecture doc's event log exactly", () => {
    expect(WORKOUT_EVENT_TYPES).toEqual([
      "set_completed",
      "rest_started",
      "rest_completed",
      "exercise_completed",
      "workout_paused",
      "workout_resumed",
      "workout_finished",
    ]);
  });

  /** The prototype's four-value qualitative RPE row on the `done` screen, in its own order. */
  it("PERCEIVED_EFFORTS matches the design's RPE row order exactly", () => {
    expect(PERCEIVED_EFFORTS).toEqual(["easy", "solid", "hard", "brutal"]);
  });

  it("WORKOUT_SESSION_STATUSES covers the whole lifecycle a live session can reach", () => {
    expect(WORKOUT_SESSION_STATUSES).toEqual([
      "in_progress",
      "paused",
      "completed",
      "cancelled",
    ]);
  });

  it("WORKOUT_SET_TYPES leads with the only type the live screen writes today", () => {
    expect(WORKOUT_SET_TYPES[0]).toBe("working");
    expect(WORKOUT_SET_TYPES).toContain("warmup");
  });
});
