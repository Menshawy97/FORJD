import type { AxiosError } from 'axios';

import { uploadWorkoutSession } from '@/auth/apiClient';
import type { WorkoutSessionUploadRequest } from '@forjd/contracts';
import { drainSyncQueue, ensureWorkoutSessionSchema, openWorkoutSessionDb, UploadRejection } from '@/store/workout-session';

/**
 * Translates an `AxiosError`'s response status onto the typed `UploadRejection` the store
 * classifies failures with (C3) -- the one place this module knows about HTTP at all, so
 * `workout-session.ts` never has to import axios or the API client to tell a deterministic
 * 4xx apart from a transient network failure.
 */
async function uploadSession(body: WorkoutSessionUploadRequest): Promise<void> {
  try {
    await uploadWorkoutSession(body);
  } catch (error) {
    const status = (error as Partial<AxiosError>)?.isAxiosError
      ? (error as AxiosError).response?.status
      : undefined;
    if (status === undefined) throw error;
    const rejection: UploadRejection = Object.assign(
      new Error(error instanceof Error ? error.message : String(error)),
      { status },
    );
    throw rejection;
  }
}

/**
 * Actually uploads the finished sessions sitting in the local queue (Phase 3I).
 *
 * `drainSyncQueue` and its retry/backoff have existed since Phase F and were fully tested --
 * but **nothing ever called them**, so a finished workout was enqueued and then sat on the
 * device forever. This is the trigger that closes that loop.
 *
 * **Deliberately fire-and-forget, and deliberately silent.** Sync is not something the athlete
 * asked for at the moment it happens, so a failure is not theirs to see: the queue keeps the
 * session, backs off, and tries again on the next trigger. ADR-025 owns that retry policy; this
 * only decides *when* to ask.
 *
 * It is safe to call often. A row whose `next_retry_at` has not passed, or which has already
 * exhausted its attempts, is skipped without a request -- so calling this on every app
 * foreground costs nothing when there is nothing to send.
 */
export async function syncPendingSessions(): Promise<{ uploaded: string[]; failed: string[] }> {
  try {
    const db = await openWorkoutSessionDb();
    await ensureWorkoutSessionSchema(db);
    return await drainSyncQueue(db, uploadSession);
  } catch {
    // Nothing to surface: the queue is durable, and the next trigger tries again.
    return { uploaded: [], failed: [] };
  }
}
