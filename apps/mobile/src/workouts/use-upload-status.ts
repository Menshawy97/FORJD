import { useEffect, useState } from 'react';

import { isSessionQueued, syncPendingSessions } from './sync-sessions';

export type UploadStatus = 'checking' | 'saved' | 'waiting';

/**
 * What a just-finished session's summary says about its upload (production smoke test 2026-10-20: both summaries
 * said "logged offline" for a session already on the server). The summary tries the upload straight away, while the
 * athlete is looking at it, then asks the queue whether the session is still there.
 *
 * Without a session id (`sessionId` undefined, a summary staged before this existed) nothing is checked and the
 * summary keeps saying it will sync. `enabled: false` (a summary read back from history) checks nothing either.
 */
export function useUploadStatus(sessionId: string | undefined, enabled = true): UploadStatus {
  const [status, setStatus] = useState<UploadStatus>(sessionId && enabled ? 'checking' : 'waiting');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      await syncPendingSessions();
      if (!sessionId) return;
      const queued = await isSessionQueued(sessionId);
      if (!cancelled) setStatus(queued ? 'waiting' : 'saved');
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, enabled]);

  return status;
}

/** The summary's subtitle for a just-finished session: the name, then whether it is saved yet. */
export function uploadStatusLine(name: string, status: UploadStatus): string {
  if (status === 'saved') return `${name} · saved.`;
  if (status === 'waiting') return `${name} · logged offline, will sync when you are back online.`;
  return name;
}
