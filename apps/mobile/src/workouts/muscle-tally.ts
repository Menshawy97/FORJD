import type { MuscleGroup } from '@forjd/domain';

/** One exercise of a finished workout: how many of its sets were completed. */
export interface CompletedExercise {
  exerciseId: string;
  setCount: number;
}

export interface MuscleSets {
  muscle: MuscleGroup;
  sets: number;
}

/**
 * "Muscles worked" on the workout summary: each exercise's completed sets credited to its primary muscles,
 * most worked first. An exercise with no completed sets, or one the catalogue cannot resolve, adds nothing.
 * It used to add 1 per exercise, done or not, under a "sets" label (emulator walk 2026-10-14, finding 13).
 */
export async function tallyMuscleSets(
  exercises: readonly CompletedExercise[],
  primaryMusclesOf: (exerciseId: string) => Promise<readonly MuscleGroup[] | null>,
): Promise<MuscleSets[]> {
  const tally = new Map<MuscleGroup, number>();
  for (const { exerciseId, setCount } of exercises) {
    if (setCount <= 0) continue;
    for (const muscle of (await primaryMusclesOf(exerciseId)) ?? []) {
      tally.set(muscle, (tally.get(muscle) ?? 0) + setCount);
    }
  }
  return [...tally.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets);
}
