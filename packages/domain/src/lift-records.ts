import type { PrRecord } from "./push-messages";
import type { WorkoutSessionExercise } from "./workout-vocabulary";

/**
 * Which lifts a session set a record on (Phase 12F, docs/product/phase-12f-plan.md). Pure: the caller reads the person's
 * best before the session, this decides. A lift is a record when the session's heaviest completed set beats that best;
 * the first time anyone lifts an exercise is not one, because there is nothing yet to beat.
 */
export interface LiftComparison {
  exerciseId: string;
  exerciseName: string;
  /** This session's heaviest completed set of the exercise, in kilograms. */
  bestKg: number;
  /** The heaviest before this session, or `null` the first time. */
  priorBestKg: number | null;
}

/** Heaviest completed, weighted set (with reps) per weight exercise of one session. Same set rule as the Home PR card. */
export function sessionLiftBests(exercises: readonly WorkoutSessionExercise[]): Map<string, number> {
  const bests = new Map<string, number>();
  for (const exercise of exercises) {
    if (exercise.measure !== "weight") continue;
    for (const set of exercise.sets) {
      if (!set.isCompleted || set.weightKg === null || set.reps === null || set.weightKg <= 0) continue;
      const best = bests.get(exercise.exerciseId);
      if (best === undefined || set.weightKg > best) bests.set(exercise.exerciseId, set.weightKg);
    }
  }
  return bests;
}

/** Records in order of the biggest jump first. Empty when nothing was beaten. */
export function detectLiftRecords(lifts: readonly LiftComparison[]): PrRecord[] {
  return lifts
    .flatMap((lift) =>
      lift.priorBestKg !== null && lift.bestKg > lift.priorBestKg
        ? [{ jump: lift.bestKg - lift.priorBestKg, record: { type: "lift", exerciseName: lift.exerciseName } as const }]
        : [],
    )
    .sort((a, b) => b.jump - a.jump)
    .map((entry) => entry.record);
}
