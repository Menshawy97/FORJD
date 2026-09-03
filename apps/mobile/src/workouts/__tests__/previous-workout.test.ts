// RED first, Phase 3J-b. Everything the "Previous Workout" card shows is derived from a
// `WorkoutSessionResponse`, and none of it is React — so it is tested here, as a pure module,
// the same split `live-session.ts` uses.
import type { WorkoutSessionResponse } from '@forjd/contracts';

import {
  formatHistoryDate,
  formatRelativeDay,
  formatSessionDuration,
  sessionExerciseChips,
  sessionVolumeKg,
  toRepeatExercises,
} from '../previous-workout';

function session(overrides: Partial<WorkoutSessionResponse> = {}): WorkoutSessionResponse {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    templateId: null,
    name: 'Upper Body Push',
    activity: 'strength',
    status: 'completed',
    startedAt: '2026-09-02T18:00:00.000Z',
    endedAt: '2026-09-02T18:45:12.000Z',
    durationSeconds: 2712,
    perceivedEffort: null,
    notes: null,
    city: null,
    citySlug: null,
    isLiveTracked: false,
    exercises: [],
    ...overrides,
  };
}

function set(overrides: Partial<WorkoutSessionResponse['exercises'][number]['sets'][number]> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    setIndex: 0,
    type: 'working' as const,
    isCompleted: true,
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceMeters: null,
    restSeconds: null,
    completedAt: '2026-09-02T18:10:00.000Z',
    ...overrides,
  };
}

describe('formatSessionDuration', () => {
  // The prototype's meta line reads `45:12`, and the summary screen's Duration tile uses the
  // same shape -- this is the formatter that screen already had, now shared rather than copied.
  it('writes minutes and seconds with a padded seconds field', () => {
    expect(formatSessionDuration(2712)).toBe('45:12');
    expect(formatSessionDuration(61)).toBe('1:01');
    expect(formatSessionDuration(0)).toBe('0:00');
  });

  it('grows an hours field only once there is an hour to show', () => {
    expect(formatSessionDuration(3600)).toBe('1:00:00');
    expect(formatSessionDuration(3731)).toBe('1:02:11');
  });

  it('never renders a negative or fractional duration', () => {
    expect(formatSessionDuration(-5)).toBe('0:00');
    expect(formatSessionDuration(90.9)).toBe('1:30');
  });
});

describe('formatRelativeDay', () => {
  // Calendar days apart, not elapsed hours: a session at 23:00 last night is "Yesterday" at
  // 07:00 this morning even though only eight hours have passed.
  const now = new Date('2026-09-03T09:00:00');

  it('names today and yesterday', () => {
    expect(formatRelativeDay(new Date('2026-09-03T06:00:00'), now)).toBe('Today');
    expect(formatRelativeDay(new Date('2026-09-02T23:00:00'), now)).toBe('Yesterday');
  });

  it('counts days up to a week, then weeks', () => {
    expect(formatRelativeDay(new Date('2026-09-01T10:00:00'), now)).toBe('2 days ago');
    expect(formatRelativeDay(new Date('2026-08-28T10:00:00'), now)).toBe('6 days ago');
    expect(formatRelativeDay(new Date('2026-08-27T10:00:00'), now)).toBe('Last week');
    expect(formatRelativeDay(new Date('2026-08-21T10:00:00'), now)).toBe('Last week');
    expect(formatRelativeDay(new Date('2026-08-20T10:00:00'), now)).toBe('2 weeks ago');
  });

  // A clock skew or a session started a moment ago must not read "-1 days ago".
  it('treats a future timestamp as today', () => {
    expect(formatRelativeDay(new Date('2026-09-04T10:00:00'), now)).toBe('Today');
  });
});

describe('sessionVolumeKg', () => {
  it('sums weight times reps across every completed set', () => {
    const total = sessionVolumeKg(
      session({
        exercises: [
          {
            id: 'e1',
            exerciseId: 'x1',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [set({ weightKg: 100, reps: 10 }), set({ setIndex: 1, weightKg: 80, reps: 8 })],
          },
        ],
      }),
    );
    expect(total).toBe(1640);
  });

  // A set the athlete never ticked was never performed -- counting it would inflate the
  // figure the card presents as what they actually lifted.
  it('ignores sets that were not completed', () => {
    const total = sessionVolumeKg(
      session({
        exercises: [
          {
            id: 'e1',
            exerciseId: 'x1',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [
              set({ weightKg: 100, reps: 10 }),
              set({ setIndex: 1, isCompleted: false, weightKg: 999, reps: 99 }),
            ],
          },
        ],
      }),
    );
    expect(total).toBe(1000);
  });

  // Bodyweight and timed work carry no external load, so they contribute nothing to a volume
  // total -- they are not zero-weight lifts, they are a different measure.
  it('contributes nothing for sets with no weight or no reps', () => {
    const total = sessionVolumeKg(
      session({
        exercises: [
          {
            id: 'e1',
            exerciseId: 'x1',
            orderIndex: 0,
            measure: 'time',
            notes: null,
            sets: [set({ durationSeconds: 60 }), set({ setIndex: 1, weightKg: 60, reps: null })],
          },
        ],
      }),
    );
    expect(total).toBe(0);
  });
});

describe('sessionExerciseChips', () => {
  const resolveName = (id: string) => ({ x1: 'Bench Press', x2: 'Dips' })[id] ?? null;

  it('writes each exercise as its heaviest completed set, weight by reps', () => {
    const chips = sessionExerciseChips(
      session({
        exercises: [
          {
            id: 'e1',
            exerciseId: 'x1',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [
              set({ weightKg: 80, reps: 8 }),
              set({ setIndex: 1, weightKg: 82.5, reps: 6 }),
              set({ setIndex: 2, weightKg: 80, reps: 8 }),
            ],
          },
        ],
      }),
      resolveName,
    );
    expect(chips).toEqual(['Bench Press 82.5×6']);
  });

  // The prototype's own fourth chip is `Dips BW×12` -- a set logged without a weight is
  // bodyweight, not "0 kg".
  it('writes a weightless set as BW', () => {
    const chips = sessionExerciseChips(
      session({
        exercises: [
          {
            id: 'e2',
            exerciseId: 'x2',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [set({ weightKg: null, reps: 12 })],
          },
        ],
      }),
      resolveName,
    );
    expect(chips).toEqual(['Dips BW×12']);
  });

  it('writes timed and distance work in their own units', () => {
    const chips = sessionExerciseChips(
      session({
        exercises: [
          {
            id: 'e1',
            exerciseId: 'x1',
            orderIndex: 0,
            measure: 'time',
            notes: null,
            sets: [set({ durationSeconds: 45 })],
          },
          {
            id: 'e2',
            exerciseId: 'x2',
            orderIndex: 1,
            measure: 'distance',
            notes: null,
            sets: [set({ distanceMeters: 800 })],
          },
        ],
      }),
      resolveName,
    );
    expect(chips).toEqual(['Bench Press 45s', 'Dips 800m']);
  });

  // The catalogue is a local cache and can miss an id -- a chip with no name is worse than no
  // chip, but losing the whole card over one unknown exercise is worse still.
  it('falls back to a neutral name when the catalogue cannot resolve the exercise', () => {
    const chips = sessionExerciseChips(
      session({
        exercises: [
          {
            id: 'e9',
            exerciseId: 'unknown',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [set({ weightKg: 60, reps: 5 })],
          },
        ],
      }),
      resolveName,
    );
    expect(chips).toEqual(['Exercise 60×5']);
  });

  it('skips an exercise with nothing completed rather than writing an empty chip', () => {
    const chips = sessionExerciseChips(
      session({
        exercises: [
          {
            id: 'e1',
            exerciseId: 'x1',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [set({ isCompleted: false, weightKg: 80, reps: 8 })],
          },
        ],
      }),
      resolveName,
    );
    expect(chips).toEqual([]);
  });

  it('orders chips by the session order, not the order the sets happen to arrive in', () => {
    const chips = sessionExerciseChips(
      session({
        exercises: [
          {
            id: 'e2',
            exerciseId: 'x2',
            orderIndex: 1,
            measure: 'weight',
            notes: null,
            sets: [set({ weightKg: null, reps: 12 })],
          },
          {
            id: 'e1',
            exerciseId: 'x1',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [set({ weightKg: 80, reps: 8 })],
          },
        ],
      }),
      resolveName,
    );
    expect(chips).toEqual(['Bench Press 80×8', 'Dips BW×12']);
  });
});

// `Repeat` starts a *new* session shaped like the previous one. It is a separate derivation
// from the chips because it feeds the live screen rather than the card, and because getting it
// wrong in either direction is bad in a specific way: carry the ticks over and the athlete is
// handed a workout that claims to be already finished; drop the loads and they have to retype
// every weight they lifted last time.
describe('toRepeatExercises', () => {
  const resolveExercise = (id: string) =>
    ({
      x1: { name: 'Bench Press', goal: 'strength' as const },
      x2: { name: 'Dips', goal: null },
    })[id] ?? null;

  const twoExerciseSession = () =>
    session({
      exercises: [
        {
          id: 'e1',
          exerciseId: 'x1',
          orderIndex: 0,
          measure: 'weight',
          notes: null,
          sets: [
            set({ weightKg: 80, reps: 8 }),
            set({ setIndex: 1, weightKg: 82.5, reps: 6 }),
            set({ setIndex: 2, isCompleted: false, weightKg: 80, reps: 8 }),
          ],
        },
        {
          id: 'e2',
          exerciseId: 'x2',
          orderIndex: 1,
          measure: 'weight',
          notes: null,
          sets: [set({ weightKg: null, reps: 12 })],
        },
      ],
    });

  it('keeps every set with the load that was logged, so nothing has to be retyped', () => {
    const [bench] = toRepeatExercises(twoExerciseSession(), resolveExercise);

    expect(bench.sets).toEqual([
      { setIndex: 0, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
      { setIndex: 1, isCompleted: false, weightKg: 82.5, reps: 6, durationSeconds: null, distanceMeters: null },
      { setIndex: 2, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
    ]);
  });

  it('starts every set unticked, including the ones that were completed last time', () => {
    const exercises = toRepeatExercises(twoExerciseSession(), resolveExercise);

    expect(exercises.flatMap((exercise) => exercise.sets).every((s) => !s.isCompleted)).toBe(true);
  });

  it('resolves names and goals from the catalogue, in session order', () => {
    const exercises = toRepeatExercises(twoExerciseSession(), resolveExercise);

    expect(exercises.map((exercise) => [exercise.name, exercise.goal, exercise.measure])).toEqual([
      ['Bench Press', 'strength', 'weight'],
      ['Dips', null, 'weight'],
    ]);
  });

  it('renumbers set indexes densely, whatever the response happened to carry', () => {
    const exercises = toRepeatExercises(
      session({
        exercises: [
          {
            id: 'e1',
            exerciseId: 'x1',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [set({ setIndex: 5, weightKg: 60, reps: 5 }), set({ setIndex: 9, weightKg: 65, reps: 5 })],
          },
        ],
      }),
      resolveExercise,
    );

    expect(exercises[0].sets.map((s) => s.setIndex)).toEqual([0, 1]);
  });

  // An exercise that has been deleted from the catalogue since is still something the athlete
  // performed -- it keeps its place in the repeated session under a neutral name.
  it('keeps an unresolvable exercise rather than silently dropping it from the workout', () => {
    const exercises = toRepeatExercises(
      session({
        exercises: [
          {
            id: 'e9',
            exerciseId: 'gone',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [set({ weightKg: 60, reps: 5 })],
          },
        ],
      }),
      resolveExercise,
    );

    expect(exercises).toHaveLength(1);
    expect(exercises[0].name).toBe('Exercise');
    expect(exercises[0].goal).toBeNull();
  });
});

// Phase 3J-d: the exercise-detail History list. A different job from `formatRelativeDay`:
// "three weeks ago" is precise but useless for locating a session in a list, so the relative
// form is kept only while it genuinely reads better.
describe('formatHistoryDate', () => {
  const now = new Date('2026-09-03T09:00:00');

  it('keeps the relative form while it still reads better than a date', () => {
    expect(formatHistoryDate(new Date('2026-09-03T06:00:00'), now)).toBe('Today');
    expect(formatHistoryDate(new Date('2026-09-02T10:00:00'), now)).toBe('Yesterday');
    expect(formatHistoryDate(new Date('2026-08-30T10:00:00'), now)).toBe('4 days ago');
  });

  // The prototype's own rows read `Yesterday`, `16 Aug`, `12 Aug`, `9 Aug`.
  it('falls back to a day and month once a week has passed', () => {
    expect(formatHistoryDate(new Date('2026-08-16T10:00:00'), now)).toBe('16 Aug');
    expect(formatHistoryDate(new Date('2026-08-09T10:00:00'), now)).toBe('9 Aug');
  });

  it('writes a January date without a leading zero, as the design does', () => {
    expect(formatHistoryDate(new Date('2026-01-05T10:00:00'), now)).toBe('5 Jan');
  });
});
