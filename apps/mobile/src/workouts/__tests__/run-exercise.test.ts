import type { ExerciseResponse } from '@forjd/contracts';

import { RUN_EXERCISE_PLACEHOLDER_ID, RUN_EXERCISE_SLUG } from '../live-run';
import { resolveRunExerciseId } from '../run-exercise';
import type { SqliteConnection } from '@/store/exercise-catalogue';

const exercise = (over: Partial<ExerciseResponse> = {}): ExerciseResponse =>
  ({
    id: 'real-outdoor-run-id',
    slug: RUN_EXERCISE_SLUG,
    name: 'Outdoor Run',
    ...over,
  }) as ExerciseResponse;

describe('resolveRunExerciseId', () => {
  const db = {} as SqliteConnection;

  it('finds the Outdoor Run exercise among the search results by its slug', async () => {
    const search = jest.fn().mockResolvedValue([exercise({ id: 'tempo-id', slug: 'tempo-intervals' }), exercise()]);

    await expect(resolveRunExerciseId(db, search)).resolves.toBe('real-outdoor-run-id');
    expect(search).toHaveBeenCalledWith(db, 'Outdoor Run');
  });

  it('is null when the catalogue has not synced it in yet', async () => {
    const search = jest.fn().mockResolvedValue([]);
    await expect(resolveRunExerciseId(db, search)).resolves.toBeNull();
  });

  it('is null rather than throwing when the local search itself fails', async () => {
    const search = jest.fn().mockRejectedValue(new Error('db locked'));
    await expect(resolveRunExerciseId(db, search)).resolves.toBeNull();
  });
});

describe('RUN_EXERCISE_PLACEHOLDER_ID', () => {
  it('is a well-formed uuid, since the upload schema requires one', () => {
    expect(RUN_EXERCISE_PLACEHOLDER_ID).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
