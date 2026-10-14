// The live workout's PREV column and the start-filled sets (docs/product/live-prev-column-plan.md; replica approved
// 2026-10-14): last time's same set, completed sets only, shown in the exercise's unit, and a fill that only ever
// touches a set still exactly as the workout laid it out.
import type { WorkoutSessionResponse, WorkoutSessionUploadRequest } from '@forjd/contracts';

import { startSession, updateSet, type LiveSession } from '../live-session';
import {
  completedSetsFromSession,
  completedSetsFromUpload,
  prefillFromPrevious,
  previousLabel,
  type PreviousSet,
} from '../previous-sets';

const BENCH = '11111111-1111-4111-8111-111111111111';
const PLANK = '22222222-2222-4222-8222-222222222222';

const set = (over: Partial<PreviousSet>): PreviousSet => ({
  weightKg: null,
  reps: null,
  durationSeconds: null,
  distanceMeters: null,
  ...over,
});

function responseSet(index: number, isCompleted: boolean, over: Record<string, unknown> = {}) {
  return {
    id: `0000000${index}-0000-4000-8000-000000000000`,
    setIndex: index,
    type: 'working',
    isCompleted,
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceMeters: null,
    restSeconds: null,
    completedAt: null,
    ...over,
  };
}

function sessionResponse(exercises: WorkoutSessionResponse['exercises']): WorkoutSessionResponse {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    templateId: null,
    name: 'Bench Day',
    activity: 'strength',
    status: 'completed',
    startedAt: '2026-10-10T08:00:00.000Z',
    endedAt: '2026-10-10T09:00:00.000Z',
    durationSeconds: 3600,
    perceivedEffort: null,
    notes: null,
    city: null,
    citySlug: null,
    isLiveTracked: true,
    exercises,
  } as WorkoutSessionResponse;
}

describe('completedSetsFromSession', () => {
  it("takes the exercise's completed sets in order, closing the gap a skipped set leaves", () => {
    const response = sessionResponse([
      {
        id: 'e1',
        exerciseId: BENCH,
        orderIndex: 0,
        measure: 'weight',
        notes: null,
        sets: [
          responseSet(0, true, { weightKg: 40, reps: 10 }),
          responseSet(1, false, { weightKg: 40, reps: 10 }),
          responseSet(2, true, { weightKg: 37.5, reps: 8 }),
        ],
      },
    ] as WorkoutSessionResponse['exercises']);

    expect(completedSetsFromSession(response, BENCH)).toEqual([
      set({ weightKg: 40, reps: 10 }),
      set({ weightKg: 37.5, reps: 8 }),
    ]);
  });

  it('is null when the exercise is not in the session, or none of its sets were done', () => {
    const response = sessionResponse([
      { id: 'e1', exerciseId: BENCH, orderIndex: 0, measure: 'weight', notes: null, sets: [responseSet(0, false)] },
    ] as WorkoutSessionResponse['exercises']);

    expect(completedSetsFromSession(response, BENCH)).toBeNull();
    expect(completedSetsFromSession(response, PLANK)).toBeNull();
  });
});

describe('completedSetsFromUpload', () => {
  it('gives each exercise its completed sets from a finished workout', () => {
    const request = {
      exercises: [
        {
          exerciseId: BENCH,
          sets: [
            { type: 'working', isCompleted: true, weightKg: 40, reps: 10 },
            { type: 'working', isCompleted: false, weightKg: 40, reps: 10 },
          ],
        },
        { exerciseId: PLANK, sets: [{ type: 'working', isCompleted: false, durationSeconds: 45 }] },
      ],
    } as unknown as WorkoutSessionUploadRequest;

    expect(completedSetsFromUpload(request)).toEqual(new Map([[BENCH, [set({ weightKg: 40, reps: 10 })]]]));
  });
});

describe('previousLabel', () => {
  it('reads weight and reps in the exercise unit', () => {
    expect(previousLabel(set({ weightKg: 40, reps: 10 }), 'weight', 'kg', 'm')).toBe('40 × 10');
    expect(previousLabel(set({ weightKg: 20, reps: 10 }), 'weight', 'lb', 'm')).toBe('44 × 10');
    expect(previousLabel(set({ weightKg: 40 }), 'weight', 'kg', 'm')).toBe('40 kg');
    expect(previousLabel(set({ reps: 12 }), 'weight', 'kg', 'm')).toBe('× 12');
  });

  it('reads a time and a distance', () => {
    expect(previousLabel(set({ durationSeconds: 45 }), 'time', 'kg', 'm')).toBe('0:45');
    expect(previousLabel(set({ durationSeconds: 90 }), 'time', 'kg', 'm')).toBe('1:30');
    expect(previousLabel(set({ distanceMeters: 400 }), 'distance', 'kg', 'm')).toBe('400 m');
    expect(previousLabel(set({ distanceMeters: 1609.344 }), 'distance', 'kg', 'mi')).toBe('1 mi');
  });

  it('is a dash when there is no set to show, or nothing in it', () => {
    expect(previousLabel(undefined, 'weight', 'kg', 'm')).toBe('—');
    expect(previousLabel(set({}), 'weight', 'kg', 'm')).toBe('—');
  });
});

describe('prefillFromPrevious', () => {
  function bench(): LiveSession {
    return startSession({
      id: 's1',
      templateId: null,
      name: 'Bench Day',
      activity: 'strength',
      startedAt: new Date('2026-10-14T08:00:00.000Z'),
      exercises: [
        { exerciseId: BENCH, name: 'Bench', measure: 'weight', sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }, { reps: 10 }] },
      ],
    });
  }
  const LAST_TIME = [set({ weightKg: 40, reps: 10 }), set({ weightKg: 40, reps: 10 }), set({ weightKg: 37.5, reps: 8 })];

  it("fills each untouched set with last time's same set, and leaves a set with no match as laid out", () => {
    const session = bench();
    const laidOut = session.exercises[0]!.sets;

    const filled = prefillFromPrevious(session, 0, LAST_TIME, laidOut).exercises[0]!.sets;

    expect(filled.map((s) => [s.weightKg, s.reps])).toEqual([
      [40, 10],
      [40, 10],
      [37.5, 8],
      [null, 10],
    ]);
    expect(filled.every((s) => !s.isCompleted)).toBe(true);
  });

  it('never overwrites a set the person already typed into', () => {
    const session = bench();
    const laidOut = session.exercises[0]!.sets;
    const edited = updateSet(session, 0, 1, { weightKg: 50 });

    const filled = prefillFromPrevious(edited, 0, LAST_TIME, laidOut).exercises[0]!.sets;

    expect(filled[1]).toMatchObject({ weightKg: 50, reps: 10 });
    expect(filled[0]).toMatchObject({ weightKg: 40, reps: 10 });
  });

  it('keeps the laid-out value where last time has none', () => {
    const session = bench();
    const laidOut = session.exercises[0]!.sets;

    const filled = prefillFromPrevious(session, 0, [set({ weightKg: 40 })], laidOut).exercises[0]!.sets;

    expect(filled[0]).toMatchObject({ weightKg: 40, reps: 10 });
  });

  it('is unchanged for an exercise index that does not exist', () => {
    const session = bench();

    expect(prefillFromPrevious(session, 5, LAST_TIME, [])).toBe(session);
  });
});
