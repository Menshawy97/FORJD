import type { WorkoutSessionResponse, WorkoutSessionUploadRequest } from '@forjd/contracts';
import {
  distanceForDisplay,
  weightForDisplay,
  type DistanceDisplayUnit,
  type ExerciseMeasure,
  type WeightDisplayUnit,
} from '@forjd/domain';

import type { LiveSession, LiveSet } from './live-session';

/**
 * The live workout's PREV column and the sets that start filled in (owner request 2026-10-14, replica approved;
 * docs/product/live-prev-column-plan.md). Pure: the history comes in from `load-previous-sets.ts`.
 *
 * "Last time" is the most recent session with the exercise, and only its **completed** sets count, in the order they
 * were done: set 1 of today lines up with the first set actually done last time.
 */
export interface PreviousSet {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

const DASH = '—';

interface SetValues {
  isCompleted: boolean;
  weightKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
}

const toPrevious = (set: SetValues): PreviousSet => ({
  weightKg: set.weightKg ?? null,
  reps: set.reps ?? null,
  durationSeconds: set.durationSeconds ?? null,
  distanceMeters: set.distanceMeters ?? null,
});

const completed = (sets: readonly SetValues[]): PreviousSet[] => sets.filter((set) => set.isCompleted).map(toPrevious);

/** The exercise's completed sets in a stored session (its first entry with any), or `null` when there are none. */
export function completedSetsFromSession(session: WorkoutSessionResponse, exerciseId: string): PreviousSet[] | null {
  const entries = [...session.exercises]
    .filter((exercise) => exercise.exerciseId === exerciseId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  for (const entry of entries) {
    const sets = completed([...entry.sets].sort((a, b) => a.setIndex - b.setIndex));
    if (sets.length > 0) return sets;
  }
  return null;
}

/** Every exercise's completed sets in a workout just finished; an exercise with none is left out. */
export function completedSetsFromUpload(request: WorkoutSessionUploadRequest): Map<string, PreviousSet[]> {
  const byExercise = new Map<string, PreviousSet[]>();
  for (const exercise of request.exercises) {
    if (byExercise.has(exercise.exerciseId)) continue;
    const sets = completed(exercise.sets);
    if (sets.length > 0) byExercise.set(exercise.exerciseId, sets);
  }
  return byExercise;
}

function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.round(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** What PREV shows for one set, in the exercise's display unit: "40 × 10", "40 kg", "× 12", "0:45", "400 m". */
export function previousLabel(
  set: PreviousSet | undefined,
  measure: ExerciseMeasure,
  weightUnit: WeightDisplayUnit,
  distanceUnit: DistanceDisplayUnit,
): string {
  if (!set) return DASH;
  if (measure === 'time') return set.durationSeconds === null ? DASH : formatSeconds(set.durationSeconds);
  if (measure === 'distance') {
    return set.distanceMeters === null ? DASH : `${distanceForDisplay(set.distanceMeters, distanceUnit)} ${distanceUnit}`;
  }
  const weight = set.weightKg === null ? null : weightForDisplay(set.weightKg, weightUnit);
  if (weight !== null && set.reps !== null) return `${weight} × ${set.reps}`;
  if (weight !== null) return `${weight} ${weightUnit}`;
  if (set.reps !== null) return `× ${set.reps}`;
  return DASH;
}

const sameValues = (a: LiveSet, b: LiveSet): boolean =>
  a.weightKg === b.weightKg &&
  a.reps === b.reps &&
  a.durationSeconds === b.durationSeconds &&
  a.distanceMeters === b.distanceMeters;

/**
 * Fills one exercise's sets with last time's same sets. Only a set still exactly as the workout laid it out
 * (`laidOut`: not ticked, not edited) is filled, so a value the person typed is never overwritten, even when the
 * history arrives late. Where last time has no value, the laid-out one stays.
 */
export function prefillFromPrevious(
  session: LiveSession,
  exerciseIndex: number,
  previous: readonly PreviousSet[],
  laidOut: readonly LiveSet[],
): LiveSession {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise) return session;
  let changed = false;
  const sets = exercise.sets.map((set, index) => {
    const last = previous[index];
    const original = laidOut[index];
    if (!last || !original || set.isCompleted || !sameValues(set, original)) return set;
    changed = true;
    return {
      ...set,
      weightKg: last.weightKg ?? set.weightKg,
      reps: last.reps ?? set.reps,
      durationSeconds: last.durationSeconds ?? set.durationSeconds,
      distanceMeters: last.distanceMeters ?? set.distanceMeters,
    };
  });
  if (!changed) return session;
  return {
    ...session,
    exercises: session.exercises.map((current, index) => (index === exerciseIndex ? { ...current, sets } : current)),
  };
}
