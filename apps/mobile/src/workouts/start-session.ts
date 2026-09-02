import { randomUUID } from 'expo-crypto';

import type { ExerciseGoal, ExerciseMeasure } from '@forjd/domain';

import type { LiveExercise, LiveSet } from './live-session';

/**
 * Turns a prescription into a startable session (Phase 3H, slice H5).
 *
 * Two screens start workouts -- the builder's "Start now" and the workout detail screen's
 * "Start workout" -- and they hold their exercises in different shapes. Both funnel through
 * here so the expansion happens once: a template says "4 sets of 8", and a session needs four
 * distinct, individually tickable rows.
 */

/**
 * The session id, which is also the **sync idempotency key** (`WorkoutSession.id`): a retried
 * upload after a dropped response must not create a second session, so the id has to be
 * generated on the device at creation and then never change.
 *
 * `expo-crypto`'s `randomUUID` rather than anything hand-rolled from `Math.random`, because
 * this value has to stay unique across devices once it reaches the server.
 */
export function newSessionId(): string {
  return randomUUID();
}

interface ExercisePrescription {
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  goal?: ExerciseGoal | null;
  /** `null` is treated as a single set -- a prescribed exercise always has something to log. */
  setCount: number | null;
  targetReps?: number | null;
  targetSeconds?: number | null;
  targetDistanceMeters?: number | null;
}

/** The design's own defaults, matching what the builder seeds a newly picked exercise with. */
const DEFAULT_REPS = 10;
const DEFAULT_SECONDS = 45;
const DEFAULT_DISTANCE_METERS = 500;

/**
 * Expands one prescription into its individual sets.
 *
 * Every set starts with the *same* prescribed target and unticked. They are separate rows
 * rather than a count because the athlete edits them independently -- the design's own set
 * table shows `80 × 8`, `80 × 8`, `82.5 × 6`, which a single "4 sets" figure cannot express.
 */
export function toLiveExercise(prescription: ExercisePrescription): LiveExercise {
  const count = Math.max(1, prescription.setCount ?? 1);
  const template: Omit<LiveSet, 'setIndex'> = {
    isCompleted: false,
    weightKg: null,
    reps: prescription.measure === 'weight' ? (prescription.targetReps ?? DEFAULT_REPS) : null,
    durationSeconds: prescription.measure === 'time' ? (prescription.targetSeconds ?? DEFAULT_SECONDS) : null,
    distanceMeters:
      prescription.measure === 'distance' ? (prescription.targetDistanceMeters ?? DEFAULT_DISTANCE_METERS) : null,
  };

  return {
    exerciseId: prescription.exerciseId,
    name: prescription.name,
    measure: prescription.measure,
    goal: prescription.goal ?? null,
    sets: Array.from({ length: count }, (_, setIndex) => ({ ...template, setIndex })),
  };
}
