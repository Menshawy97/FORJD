import { uploadWorkoutSession } from '@/auth/apiClient';
import { drainSyncQueue, ensureWorkoutSessionSchema, openWorkoutSessionDb } from '@/store/workout-session';

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
    return await drainSyncQueue(db, uploadWorkoutSession);
  } catch {
    // Nothing to surface: the queue is durable, and the next trigger tries again.
    return { uploaded: [], failed: [] };
  }
}
