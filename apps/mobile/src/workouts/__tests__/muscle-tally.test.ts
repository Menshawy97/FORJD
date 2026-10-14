// Emulator walk 2026-10-14, finding 13. "Muscles worked" on the workout summary added 1 per exercise in the
// workout, done or not, under a "sets" label: one completed set of Bench Day read "Chest 2 sets, Triceps 1
// set". It counts each exercise's completed sets against its primary muscles instead.
import type { MuscleGroup } from '@forjd/domain';

import { tallyMuscleSets } from '../muscle-tally';

const muscles: Record<string, MuscleGroup[]> = {
  bench: ['chest'],
  incline: ['chest'],
  pushdown: ['triceps'],
  pullup: ['lats', 'biceps'],
};
const lookup = async (exerciseId: string) => muscles[exerciseId] ?? null;

describe('tallyMuscleSets', () => {
  it('counts completed sets, not exercises, and skips exercises with none done', async () => {
    const rows = await tallyMuscleSets(
      [
        { exerciseId: 'bench', setCount: 1 },
        { exerciseId: 'incline', setCount: 0 },
        { exerciseId: 'pushdown', setCount: 0 },
      ],
      lookup,
    );

    expect(rows).toEqual([{ muscle: 'chest', sets: 1 }]);
  });

  it('adds sets across exercises for the same muscle and sorts the most worked first', async () => {
    const rows = await tallyMuscleSets(
      [
        { exerciseId: 'pushdown', setCount: 2 },
        { exerciseId: 'bench', setCount: 3 },
        { exerciseId: 'incline', setCount: 2 },
      ],
      lookup,
    );

    expect(rows).toEqual([
      { muscle: 'chest', sets: 5 },
      { muscle: 'triceps', sets: 2 },
    ]);
  });

  it('credits every primary muscle of an exercise with its sets', async () => {
    const rows = await tallyMuscleSets([{ exerciseId: 'pullup', setCount: 3 }], lookup);

    expect(rows).toEqual(
      expect.arrayContaining([
        { muscle: 'lats', sets: 3 },
        { muscle: 'biceps', sets: 3 },
      ]),
    );
  });

  it('leaves out an exercise the catalogue does not know', async () => {
    const rows = await tallyMuscleSets([{ exerciseId: 'unknown', setCount: 4 }], lookup);

    expect(rows).toEqual([]);
  });
});
