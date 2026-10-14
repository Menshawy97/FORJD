import {
  distanceForDisplay,
  weightForDisplay,
  type DistanceDisplayUnit,
  type ExerciseMeasure,
  type WeightDisplayUnit,
} from '@forjd/domain';

import type { CompletedSummary } from './live-handoff';

/**
 * The workout summary's per-exercise lines, for its Exercises list, its muscle counts and the share card (walk finding
 * 13; replica approved 2026-10-14, docs/product/walk-small-fixes-plan.md slice 3). One builder for a workout just
 * finished (`live.tsx`) and one opened from History (Train's Previous workout card), so both read the same.
 *
 * A line is the exercise's completed sets and its first completed set's value, in the unit the person reads that
 * exercise in: "40 kg", "44 lb", "12 reps" (no weight), "45 s", "0.80 km" or "1 mi". An exercise with nothing ticked is
 * left out: the summary is a record of what was done.
 */
export interface SummaryExerciseSource {
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  sets: readonly {
    isCompleted: boolean;
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceMeters: number | null;
  }[];
}

export type SummaryLine = NonNullable<CompletedSummary['exercises']>[number];

type DisplayUnit = WeightDisplayUnit | DistanceDisplayUnit;

function detailOf(
  measure: ExerciseMeasure,
  first: SummaryExerciseSource['sets'][number],
  unit: DisplayUnit | undefined,
): string {
  if (measure === 'time') return `${first.durationSeconds ?? 0} s`;
  if (measure === 'distance') {
    const meters = first.distanceMeters ?? 0;
    return unit === 'mi' ? `${distanceForDisplay(meters, 'mi')} mi` : `${(meters / 1000).toFixed(2)} km`;
  }
  if (first.weightKg === null) return `${first.reps ?? 0} reps`;
  const weightUnit: WeightDisplayUnit = unit === 'lb' ? 'lb' : 'kg';
  return `${weightForDisplay(first.weightKg, weightUnit)} ${weightUnit}`;
}

export function summaryExerciseLines(
  exercises: readonly SummaryExerciseSource[],
  unitFor: (exerciseId: string) => DisplayUnit | undefined,
): SummaryLine[] {
  const lines: SummaryLine[] = [];
  for (const exercise of exercises) {
    const done = exercise.sets.filter((set) => set.isCompleted);
    const first = done[0];
    if (!first) continue;
    lines.push({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      setCount: done.length,
      detail: detailOf(exercise.measure, first, unitFor(exercise.exerciseId)),
    });
  }
  return lines;
}
