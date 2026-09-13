import {
  assertNeverWorkoutBlockType,
  WorkoutBlock,
  WorkoutBlockType,
} from "./workout-vocabulary";

/**
 * R22 (H16) -- `WorkoutBlock.type` used to be a flat `WorkoutBlockType` field on an otherwise
 * uniform interface, so nothing ever forced a `switch` over it to handle every member. These
 * tests pin the exhaustiveness machinery: a runtime guard that throws instead of silently
 * doing nothing, and a compile-time proof that a `switch` which forgets a case is a build
 * failure, not a bug waiting to be discovered in production once `interval`/`amrap`/`superset`
 * actually ship.
 */
describe("workout block type exhaustiveness", () => {
  describe("assertNeverWorkoutBlockType", () => {
    it("throws, naming the offending value, instead of silently doing nothing", () => {
      // A value that could only reach here past the type system -- an unvalidated DB row, for
      // instance -- cast to `never` the same way a real caller's `default:` branch would see it.
      const unknownBlockType = "circuit" as unknown as never;

      expect(() => assertNeverWorkoutBlockType(unknownBlockType)).toThrow(/circuit/);
    });
  });

  describe("exhaustive switch over WorkoutBlockType", () => {
    /**
     * Deliberately omits the `"time_based"` case. If `WORKOUT_BLOCK_TYPES` ever gains a sixth
     * member, or if this switch is ever trimmed further, the `@ts-expect-error` below is what
     * catches it: `assertNeverWorkoutBlockType` only accepts `never`, and the compiler only
     * narrows the unhandled branch to `never` once every other member has its own `case`.
     */
    function describeBlockType(type: WorkoutBlockType): string {
      switch (type) {
        case "straight_sets":
          return "Straight sets";
        case "superset":
          return "Superset";
        case "interval":
          return "Interval";
        case "amrap":
          return "AMRAP";
        default:
          // @ts-expect-error -- `type` is narrowed to `"time_based"` here, not `never`,
          // because the switch above does not handle every WorkoutBlockType member. This
          // proves assertNeverWorkoutBlockType(type) only type-checks once every case is
          // handled -- the exhaustiveness guard this slice exists to add.
          return assertNeverWorkoutBlockType(type);
      }
    }

    it("still handles every case this switch actually implements", () => {
      expect(describeBlockType("straight_sets")).toBe("Straight sets");
      expect(describeBlockType("superset")).toBe("Superset");
      expect(describeBlockType("interval")).toBe("Interval");
      expect(describeBlockType("amrap")).toBe("AMRAP");
    });
  });

  describe("WorkoutBlock as a discriminated union", () => {
    it("narrows to the matching member's fields once `type` is checked", () => {
      const block: WorkoutBlock = {
        id: "block-1",
        templateId: "template-1",
        type: "straight_sets",
        orderIndex: 0,
        name: null,
        rounds: null,
        workSeconds: null,
        restSeconds: 90,
        capSeconds: null,
        exercises: [],
      };

      function label(b: WorkoutBlock): string {
        switch (b.type) {
          case "straight_sets":
            return "Straight sets";
          case "superset":
            return "Superset";
          case "interval":
            return "Interval";
          case "amrap":
            return "AMRAP";
          case "time_based":
            return "Time-based";
          default:
            return assertNeverWorkoutBlockType(b);
        }
      }

      expect(label(block)).toBe("Straight sets");
    });
  });
});
