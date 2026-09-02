import type { Activity, ExerciseMeasure } from '@forjd/domain';

/**
 * Cross-screen handoff for the workout builder (Phase 3G), a plain in-memory module rather
 * than a new state library -- Phase 3's own locked decision ("no new mobile state library:
 * `useState` + `useFocusEffect`... as everywhere else") is about the live session
 * specifically, but the same instinct applies here: expo-router has no built-in way for a
 * picker screen to return a result to its caller, and the two real options are a URL param
 * round-trip (awkward for a whole exercise object) or a shared module like this one.
 * `router.back()` returns to the exact same builder screen instance, preserving whatever the
 * user had already typed -- which is the whole reason this is a *set-then-back* handoff, not
 * a route param.
 *
 * Two independent pairs, one per direction data flows into the builder:
 *
 * - **Picked exercise** -- `library.tsx`'s `pick=builder` mode sets one when the user taps a
 *   row, then calls `router.back()`; the builder's `useFocusEffect` consumes it on return.
 * - **Prefill** -- `workout/[id].tsx`'s `Customise` button sets one before navigating
 *   *forward* to the builder (a fresh screen instance, unlike the picker's `back()`), copying
 *   the source template's data into the builder's local state per the prototype's own
 *   `s_workoutDetail`/`s_builder` behaviour: only the final, edited result is ever saved, and
 *   `basedOnTemplateId` travels with it as a plain field on the create request
 *   (`createWorkoutTemplateRequestSchema`'s own docblock explains why that field is
 *   client-supplied and server-validated, not derived).
 */

export interface PickedExercise {
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
}

export interface BuilderExerciseDraft {
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  setCount: number;
  targetReps: number | null;
  targetSeconds: number | null;
  targetDistanceMeters: number | null;
}

export interface BuilderPrefill {
  basedOnTemplateId: string;
  name: string;
  activity: Activity;
  exercises: BuilderExerciseDraft[];
}

let pendingPickedExercise: PickedExercise | null = null;
let pendingPrefill: BuilderPrefill | null = null;

export function setPickedExerciseForBuilder(exercise: PickedExercise): void {
  pendingPickedExercise = exercise;
}

/** Returns the pending pick and clears it -- a value is only ever consumed once. */
export function consumePickedExerciseForBuilder(): PickedExercise | null {
  const value = pendingPickedExercise;
  pendingPickedExercise = null;
  return value;
}

export function setBuilderPrefill(prefill: BuilderPrefill): void {
  pendingPrefill = prefill;
}

export function consumeBuilderPrefill(): BuilderPrefill | null {
  const value = pendingPrefill;
  pendingPrefill = null;
  return value;
}
