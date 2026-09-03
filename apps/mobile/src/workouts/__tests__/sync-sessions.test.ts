// Phase 3I -- the trigger that finally drains the finished-workout upload queue.
//
// `drainSyncQueue` and its retry/backoff shipped in Phase F and were fully tested, but nothing
// ever called them: a finished session was enqueued and then sat on the device forever. These
// cases pin the trigger's contract, which is mostly about what it must NOT do -- it must not
// throw, and it must not surface a failure the athlete did not ask about.
import { uploadWorkoutSession } from '@/auth/apiClient';
import { drainSyncQueue, ensureWorkoutSessionSchema, openWorkoutSessionDb } from '@/store/workout-session';

import { syncPendingSessions } from '../sync-sessions';

jest.mock('@/store/workout-session', () => ({
  openWorkoutSessionDb: jest.fn(),
  ensureWorkoutSessionSchema: jest.fn(),
  drainSyncQueue: jest.fn(),
}));

jest.mock('@/auth/apiClient', () => ({
  uploadWorkoutSession: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (openWorkoutSessionDb as jest.Mock).mockResolvedValue({});
  (ensureWorkoutSessionSchema as jest.Mock).mockResolvedValue(undefined);
  (drainSyncQueue as jest.Mock).mockResolvedValue({ uploaded: [], failed: [] });
});

it('drains the queue through the real upload call', async () => {
  (drainSyncQueue as jest.Mock).mockResolvedValue({ uploaded: ['session-1'], failed: [] });

  await expect(syncPendingSessions()).resolves.toEqual({ uploaded: ['session-1'], failed: [] });

  // The uploader is injected rather than reached for inside the store -- that seam is what
  // keeps `workout-session.ts` free of any import from the API client.
  expect(drainSyncQueue).toHaveBeenCalledWith({}, uploadWorkoutSession);
});

it('creates the schema first, so a first-ever run has somewhere to read from', async () => {
  await syncPendingSessions();

  expect(ensureWorkoutSessionSchema).toHaveBeenCalledWith({});
});

it('reports nothing and throws nothing when the database cannot be opened', async () => {
  (openWorkoutSessionDb as jest.Mock).mockRejectedValue(new Error('no such file'));

  await expect(syncPendingSessions()).resolves.toEqual({ uploaded: [], failed: [] });
});

it('swallows a drain failure, because the queue is durable and will retry', async () => {
  (drainSyncQueue as jest.Mock).mockRejectedValue(new Error('offline'));

  // Sync is not something the athlete asked for at this moment; a failure is not theirs to see.
  await expect(syncPendingSessions()).resolves.toEqual({ uploaded: [], failed: [] });
});

it('passes a failed upload back rather than hiding it from a caller that wants to know', async () => {
  (drainSyncQueue as jest.Mock).mockResolvedValue({ uploaded: [], failed: ['session-2'] });

  await expect(syncPendingSessions()).resolves.toEqual({ uploaded: [], failed: ['session-2'] });
});
