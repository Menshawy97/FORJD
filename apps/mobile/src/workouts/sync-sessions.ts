import type { AxiosError } from 'axios';

import { uploadWorkoutSession } from '@/auth/apiClient';
import { getAccountId } from '@/auth/secureStorage';
import { openExerciseCatalogueDb } from '@/store/exercise-catalogue';
import type { WorkoutSessionUploadRequest } from '@forjd/contracts';
import { sanitizeUploadRequest } from './live-session';
import { RUN_EXERCISE_PLACEHOLDER_ID } from './live-run';
import { resolveRunExerciseId } from './run-exercise';
import {
  drainSyncQueue,
  ensureWorkoutSessionSchema,
  getQueuedSessions,
  openWorkoutSessionDb,
  UploadRejection,
} from '@/store/workout-session';

/** Later than any retry time the queue can set, so a drain at this moment treats every row as due. */
const FAR_FUTURE = new Date(8_640_000_000_000_000);

/** Whether any workout is waiting to upload (not given up on). Never throws: an unreadable queue reads as empty. */
export async function hasPendingUploads(): Promise<boolean> {
  try {
    const db = await openWorkoutSessionDb();
    await ensureWorkoutSessionSchema(db);
    return (await getQueuedSessions(db)).some((row) => row.status === 'pending');
  } catch {
    return false;
  }
}

/**
 * A queued run still carries `RUN_EXERCISE_PLACEHOLDER_ID` (ADR-050) if it was recorded before the
 * catalogue synced the real "Outdoor Run" id in. Resolved from the on-device catalogue mirror, not
 * the network (rule 6), so this never blocks on connectivity by itself.
 *
 * **Unresolved is a retry, not a failure.** Throwing a plain `Error` (no `.status`) makes
 * `uploadSession` below treat it as transient, so `drainSyncQueue`'s own backoff tries again later
 * rather than dropping a run whose catalogue entry has not synced in yet.
 */
async function resolveRunExercise(body: WorkoutSessionUploadRequest): Promise<WorkoutSessionUploadRequest> {
  if (body.activity !== 'running') {
    return body;
  }
  const exercises = await Promise.all(
    body.exercises.map(async (exercise) => {
      if (exercise.exerciseId !== RUN_EXERCISE_PLACEHOLDER_ID) {
        return exercise;
      }
      // The catalogue is its own database. The workout log's connection used to be passed here, where
      // `exercises_fts` does not exist, so every run read as unresolved and none ever uploaded
      // (emulator walk 2026-10-14).
      const realId = await resolveRunExerciseId(await openExerciseCatalogueDb());
      if (!realId) {
        throw new Error('Outdoor Run exercise has not synced to this device yet');
      }
      return { ...exercise, exerciseId: realId };
    }),
  );
  return { ...body, exercises };
}

/**
 * Translates an `AxiosError`'s response status onto the typed `UploadRejection` the store
 * classifies failures with (C3) -- the one place this module knows about HTTP at all, so
 * `workout-session.ts` never has to import axios or the API client to tell a deterministic
 * 4xx apart from a transient network failure.
 */
function makeUploadSession() {
  return async function uploadSession(body: WorkoutSessionUploadRequest): Promise<void> {
    try {
      const resolved = await resolveRunExercise(body);
      // Sanitised here, not only when the session is built, because the queue holds payloads built
      // by earlier versions: a workout stuck behind a 400 for one out-of-range value saves on retry.
      await uploadWorkoutSession(sanitizeUploadRequest(resolved));
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
  };
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
export async function syncPendingSessions(
  options: { ignoreBackoff?: boolean } = {},
): Promise<{ uploaded: string[]; failed: string[] }> {
  try {
    const db = await openWorkoutSessionDb();
    await ensureWorkoutSessionSchema(db);
    // Only the signed-in account's sessions: the upload is filed under whoever's token carries
    // it, so another account's queued work waits for its owner (whole-app review 8.5, L3-1).
    const accountId = await getAccountId();
    // The back-online tick (`back-online-retry.ts`) has just seen the server answer, so it drains as if every
    // retry time had passed rather than waiting out a backoff built up while offline (walk finding 14).
    if (options.ignoreBackoff) return await drainSyncQueue(db, accountId, makeUploadSession(), FAR_FUTURE);
    return await drainSyncQueue(db, accountId, makeUploadSession());
  } catch {
    // Nothing to surface: the queue is durable, and the next trigger tries again.
    return { uploaded: [], failed: [] };
  }
}
