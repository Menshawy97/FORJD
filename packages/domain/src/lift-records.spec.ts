import { detectLiftRecords, sessionLiftBests } from "./lift-records";
import type { WorkoutSessionExercise, WorkoutSet } from "./workout-vocabulary";

// Phase 12F slice 5a (docs/product/phase-12f-plan.md). A lift is a record when this session's heaviest completed set beats
// the person's best before it. The first time anyone lifts an exercise is not a record: there is nothing yet to beat.
const set = (over: Partial<WorkoutSet>): WorkoutSet => ({
  id: "s",
  sessionExerciseId: "e",
  setIndex: 0,
  type: "working",
  isCompleted: true,
  weightKg: 100,
  reps: 5,
  durationSeconds: null,
  distanceMeters: null,
  restSeconds: null,
  completedAt: null,
  ...over,
});
const exercise = (exerciseId: string, sets: WorkoutSet[], measure: "weight" | "time" = "weight"): WorkoutSessionExercise =>
  ({ id: `se-${exerciseId}`, sessionId: "w", exerciseId, orderIndex: 0, measure, notes: null, sets }) as WorkoutSessionExercise;

describe("sessionLiftBests", () => {
  it("takes the heaviest completed weighted set of each exercise", () => {
    const bests = sessionLiftBests([
      exercise("squat", [set({ weightKg: 100 }), set({ weightKg: 120 }), set({ weightKg: 110 })]),
      exercise("bench", [set({ weightKg: 80 })]),
    ]);

    expect(bests).toEqual(
      new Map([
        ["squat", 120],
        ["bench", 80],
      ]),
    );
  });

  it("ignores sets that were never ticked, have no reps or no weight, and exercises that are not weight lifts", () => {
    const bests = sessionLiftBests([
      exercise("a", [set({ weightKg: 200, isCompleted: false })]),
      exercise("b", [set({ weightKg: 200, reps: null })]),
      exercise("c", [set({ weightKg: null })]),
      exercise("d", [set({ weightKg: 0 })]),
      exercise("plank", [set({ weightKg: 50 })], "time"),
    ]);

    expect(bests.size).toBe(0);
  });
});

describe("detectLiftRecords", () => {
  const lift = (exerciseId: string, exerciseName: string, bestKg: number, priorBestKg: number | null) => ({
    exerciseId,
    exerciseName,
    bestKg,
    priorBestKg,
  });

  it("is a record when the session beats the best before it", () => {
    expect(detectLiftRecords([lift("squat", "Back squat", 125, 120)])).toEqual([{ type: "lift", exerciseName: "Back squat" }]);
  });

  it("is not a record when it only equals or trails the best, or when it is the first time", () => {
    expect(
      detectLiftRecords([lift("a", "A", 120, 120), lift("b", "B", 100, 120), lift("c", "C", 100, null)]),
    ).toEqual([]);
  });

  it("puts the biggest jump first and keeps every record", () => {
    const records = detectLiftRecords([
      lift("a", "Small jump", 102.5, 100),
      lift("b", "Big jump", 130, 100),
      lift("c", "Middle jump", 110, 100),
    ]);

    expect(records.map((r) => (r.type === "lift" ? r.exerciseName : ""))).toEqual(["Big jump", "Middle jump", "Small jump"]);
  });
});
