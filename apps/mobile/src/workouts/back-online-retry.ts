/**
 * Uploads a waiting workout soon after the signal returns, while the app stays open (owner decision 2026-10-14,
 * emulator walk finding 14; docs/product/beta-readiness-plan.md). The other upload triggers (launch, returning to
 * the app, Finish, the OS background task) all miss a person who finishes offline and keeps the app open.
 *
 * One tick: nothing waiting, do nothing. Server unreachable, stop: no upload is tried, so the queue's attempt
 * count and backoff are untouched while offline. Server answers, upload at once, past the backoff. Never throws.
 */
export interface BackOnlineDeps {
  /** Whether any workout is waiting in the upload queue. */
  hasPending: () => Promise<boolean>;
  /** Whether the API answers right now. */
  ping: () => Promise<boolean>;
  /** Uploads every waiting workout now, ignoring the queue's backoff. */
  uploadNow: () => Promise<unknown>;
}

export type BackOnlineOutcome = 'idle' | 'offline' | 'uploaded';

export async function retryIfBackOnline(deps: BackOnlineDeps): Promise<BackOnlineOutcome> {
  try {
    if (!(await deps.hasPending())) return 'idle';
    if (!(await deps.ping())) return 'offline';
    await deps.uploadNow();
    return 'uploaded';
  } catch {
    return 'offline';
  }
}
