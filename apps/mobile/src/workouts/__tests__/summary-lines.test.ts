// The workout summary's per-exercise lines (walk finding 13; replica approved 2026-10-14,
// docs/product/walk-small-fixes-plan.md slice 3): completed sets and the first completed set's value, in the unit the
// person reads the exercise in. One builder for a workout just finished and one opened from History.
import { summaryExerciseLines, type SummaryExerciseSource } from '../summary-lines';

const set = (over: Partial<SummaryExerciseSource['sets'][number]>) => ({
  isCompleted: true,
  weightKg: null,
  reps: null,
  durationSeconds: null,
  distanceMeters: null,
  ...over,
});

describe('summaryExerciseLines', () => {
  it('counts completed sets and shows the first one, in kg or lb', () => {
    const lines = summaryExerciseLines(
      [
        {
          exerciseId: 'bench',
          name: 'Bench Press',
          measure: 'weight',
          sets: [set({ weightKg: 40, reps: 10 }), set({ weightKg: 42.5, reps: 8 }), set({ isCompleted: false, weightKg: 45 })],
        },
        { exerciseId: 'row', name: 'Row', measure: 'weight', sets: [set({ weightKg: 20, reps: 10 })] },
      ],
      (id) => (id === 'row' ? 'lb' : undefined),
    );

    expect(lines).toEqual([
      { exerciseId: 'bench', name: 'Bench Press', setCount: 2, detail: '40 kg' },
      { exerciseId: 'row', name: 'Row', setCount: 1, detail: '44 lb' },
    ]);
  });

  it('reads a timed set in seconds and a distance in km, or miles if chosen', () => {
    const lines = summaryExerciseLines(
      [
        { exerciseId: 'plank', name: 'Plank', measure: 'time', sets: [set({ durationSeconds: 45 })] },
        { exerciseId: 'rower', name: 'Rower', measure: 'distance', sets: [set({ distanceMeters: 800 })] },
        { exerciseId: 'run', name: 'Run', measure: 'distance', sets: [set({ distanceMeters: 1609.344 })] },
      ],
      (id) => (id === 'run' ? 'mi' : undefined),
    );

    expect(lines.map((line) => line.detail)).toEqual(['45 s', '0.80 km', '1 mi']);
  });

  it('shows reps for a set with no weight, rather than "0 kg"', () => {
    const lines = summaryExerciseLines(
      [{ exerciseId: 'dips', name: 'Dips', measure: 'weight', sets: [set({ reps: 12 })] }],
      () => undefined,
    );

    expect(lines[0]?.detail).toBe('12 reps');
  });

  it('leaves out an exercise with nothing ticked', () => {
    const lines = summaryExerciseLines(
      [{ exerciseId: 'bench', name: 'Bench Press', measure: 'weight', sets: [set({ isCompleted: false, weightKg: 40 })] }],
      () => undefined,
    );

    expect(lines).toEqual([]);
  });
});
