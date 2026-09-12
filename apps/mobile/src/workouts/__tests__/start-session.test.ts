// R15 (H10) -- `toLiveExercise` had no test at all. A time-based exercise silently getting
// `reps: 10` instead of a duration would ship today.
//
// `expo-crypto`'s `randomUUID` is a native module with no Jest shim in this project (nothing
// under test here has needed it before); a real UUID is unnecessary for proving "two calls
// produce different values", so it's mocked minimally rather than adding a project-wide shim
// for one call site.
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => Math.random().toString(36).slice(2)) }));

import type { LiveSession } from '../live-session';
import { newSessionId, toLiveExercise } from '../start-session';

const basePrescription = {
  exerciseId: 'ex-1',
  name: 'Bench Press',
  goal: 'strength' as const,
};

describe('toLiveExercise', () => {
  describe('measure-specific set shape', () => {
    it('expands a weight exercise with reps and null duration/distance', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'weight', setCount: 3, targetReps: 8 });

      expect(result.sets).toHaveLength(3);
      for (const set of result.sets) {
        expect(set.reps).toBe(8);
        expect(set.durationSeconds).toBeNull();
        expect(set.distanceMeters).toBeNull();
        expect(set.weightKg).toBeNull();
        expect(set.isCompleted).toBe(false);
      }
    });

    it('expands a time exercise with durationSeconds and null reps/distance -- never reps by default', () => {
      const result = toLiveExercise({
        ...basePrescription,
        measure: 'time',
        setCount: 2,
        targetSeconds: 60,
      });

      expect(result.sets).toHaveLength(2);
      for (const set of result.sets) {
        expect(set.durationSeconds).toBe(60);
        expect(set.reps).toBeNull();
        expect(set.distanceMeters).toBeNull();
      }
    });

    it('expands a distance exercise with distanceMeters and null reps/duration', () => {
      const result = toLiveExercise({
        ...basePrescription,
        measure: 'distance',
        setCount: 1,
        targetDistanceMeters: 1000,
      });

      expect(result.sets).toHaveLength(1);
      expect(result.sets[0]?.distanceMeters).toBe(1000);
      expect(result.sets[0]?.reps).toBeNull();
      expect(result.sets[0]?.durationSeconds).toBeNull();
    });
  });

  describe('setCount handling', () => {
    it('treats a null setCount as a single set', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'weight', setCount: null });
      expect(result.sets).toHaveLength(1);
    });

    it('treats a zero setCount as a single set, not zero sets -- a prescribed exercise always has something to log', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'weight', setCount: 0 });
      expect(result.sets).toHaveLength(1);
    });

    it('assigns dense, zero-based setIndex values matching array position', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'weight', setCount: 4 });
      expect(result.sets.map((s) => s.setIndex)).toEqual([0, 1, 2, 3]);
    });
  });

  describe('defaults apply only where the template is silent', () => {
    it('falls back to the default reps (10) when no target is given', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'weight', setCount: 1 });
      expect(result.sets[0]?.reps).toBe(10);
    });

    it('never overrides an explicit targetReps with the default', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'weight', setCount: 1, targetReps: 5 });
      expect(result.sets[0]?.reps).toBe(5);
    });

    it('falls back to the default duration (45s) when no target is given', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'time', setCount: 1 });
      expect(result.sets[0]?.durationSeconds).toBe(45);
    });

    it('never overrides an explicit targetSeconds with the default', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'time', setCount: 1, targetSeconds: 90 });
      expect(result.sets[0]?.durationSeconds).toBe(90);
    });

    it('falls back to the default distance (500m) when no target is given', () => {
      const result = toLiveExercise({ ...basePrescription, measure: 'distance', setCount: 1 });
      expect(result.sets[0]?.distanceMeters).toBe(500);
    });

    it('never overrides an explicit targetDistanceMeters with the default', () => {
      const result = toLiveExercise({
        ...basePrescription,
        measure: 'distance',
        setCount: 1,
        targetDistanceMeters: 2000,
      });
      expect(result.sets[0]?.distanceMeters).toBe(2000);
    });
  });

  it('carries the goal through unchanged, and null when absent', () => {
    const withGoal = toLiveExercise({ ...basePrescription, measure: 'weight', setCount: 1 });
    expect(withGoal.goal).toBe('strength');

    const withoutGoalField: Omit<typeof basePrescription, 'goal'> = {
      exerciseId: basePrescription.exerciseId,
      name: basePrescription.name,
    };
    const withoutGoal = toLiveExercise({ ...withoutGoalField, measure: 'weight', setCount: 1 });
    expect(withoutGoal.goal).toBeNull();
  });

  it('newSessionId produces a distinct value on every call', () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });

  it('round-trips into the payload enqueueSessionUpload sends: a time exercise never becomes reps in the upload request', () => {
    const timeExercise = toLiveExercise({ ...basePrescription, measure: 'time', setCount: 2, targetSeconds: 30 });
    // A minimal LiveSession carrying just this one exercise, enough to exercise toUploadRequest's
    // own field mapping without pulling in the reducer machinery live-session.ts otherwise needs.
    const session: LiveSession = {
      id: 'session-1',
      templateId: null,
      name: 'Timed Session',
      activity: 'strength',
      status: 'in_progress',
      startedAt: new Date('2026-09-02T09:00:00.000Z'),
      restSeconds: 90,
      exercises: [timeExercise],
    };

    // Import lazily to avoid a hard dependency if toUploadRequest's own signature changes shape --
    // this test's job is only to prove the measure survives end to end, not to pin that signature.
    const { toUploadRequest } = require('../live-session') as typeof import('../live-session');
    const request = toUploadRequest(session, new Date('2026-09-02T09:30:00.000Z'), 1800);

    const uploadedExercise = request.exercises[0];
    expect(uploadedExercise?.sets.every((s) => s.durationSeconds === 30)).toBe(true);
    expect(uploadedExercise?.sets.every((s) => s.reps === undefined || s.reps === null)).toBe(true);
  });
});
