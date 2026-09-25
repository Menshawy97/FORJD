// The offline queue can hold a finished run whose Outdoor Run exercise id is still the placeholder
// (ADR-050): the server assigns it, and a run recorded offline cannot know it yet. Uploading must
// resolve the real id first, and must never lose the run if it cannot.
import type { WorkoutSessionUploadRequest } from '@forjd/contracts';

const mockUpload = jest.fn();
jest.mock('@/auth/apiClient', () => ({ uploadWorkoutSession: (body: unknown) => mockUpload(body) }));

jest.mock('@/auth/secureStorage', () => ({ getAccountId: async () => 'account-a' }));

const mockResolve = jest.fn();
jest.mock('../run-exercise', () => ({ resolveRunExerciseId: (...args: unknown[]) => mockResolve(...args) }));

const mockOpen = jest.fn();
const mockEnsureSchema = jest.fn();
const mockDrain = jest.fn();
jest.mock('@/store/workout-session', () => ({
  openWorkoutSessionDb: () => mockOpen(),
  ensureWorkoutSessionSchema: (...args: unknown[]) => mockEnsureSchema(...args),
  drainSyncQueue: (...args: unknown[]) => mockDrain(...args),
}));

import { syncPendingSessions } from '../sync-sessions';
import { RUN_EXERCISE_PLACEHOLDER_ID } from '../live-run';

const fakeDb = { id: 'fake-db' };

const runBody = (): WorkoutSessionUploadRequest =>
  ({
    id: 'run-1',
    name: 'Outdoor Run',
    activity: 'running',
    status: 'completed',
    isLiveTracked: true,
    exercises: [{ exerciseId: RUN_EXERCISE_PLACEHOLDER_ID, sets: [{ type: 'working', isCompleted: true }] }],
  }) as WorkoutSessionUploadRequest;

describe('syncPendingSessions: resolving the run exercise placeholder', () => {
  let uploadBody: (body: WorkoutSessionUploadRequest) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpen.mockResolvedValue(fakeDb);
    mockDrain.mockImplementation(async (_db: unknown, _accountId: unknown, upload: (body: WorkoutSessionUploadRequest) => Promise<void>) => {
      uploadBody = upload;
      return { uploaded: [], failed: [] };
    });
  });

  it('swaps the placeholder id for the resolved one before uploading', async () => {
    mockResolve.mockResolvedValue('real-outdoor-run-id');
    await syncPendingSessions();

    await uploadBody(runBody());

    expect(mockResolve).toHaveBeenCalledWith(fakeDb);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        exercises: [expect.objectContaining({ exerciseId: 'real-outdoor-run-id' })],
      }),
    );
  });

  it('leaves a non-run session untouched, and never resolves for it', async () => {
    await syncPendingSessions();
    const strength = {
      id: 's-1',
      activity: 'strength',
      exercises: [{ exerciseId: 'real-id', sets: [] }],
    } as unknown as WorkoutSessionUploadRequest;

    await uploadBody(strength);

    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalledWith(strength);
  });

  it('retries later rather than uploading with an unresolved placeholder', async () => {
    mockResolve.mockResolvedValue(null);
    await syncPendingSessions();

    await expect(uploadBody(runBody())).rejects.toThrow();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
