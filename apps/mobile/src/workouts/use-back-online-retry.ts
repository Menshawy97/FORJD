import { useEffect } from 'react';
import { AppState } from 'react-native';

import { pingApi } from '@/auth/apiClient';

import { retryIfBackOnline } from './back-online-retry';
import { hasPendingUploads, syncPendingSessions } from './sync-sessions';

/** How often, while the app is open, a waiting workout is checked for a way to upload (walk finding 14). */
export const BACK_ONLINE_RETRY_MS = 30_000;

/**
 * Runs the back-online tick from the root layout while signed in and the app is in front. Each tick is a local queue
 * read when nothing is waiting; only with a workout waiting does it ask the server, and only on an answer upload.
 */
export function useBackOnlineRetry(authChecked: boolean, authenticated: boolean): void {
  useEffect(() => {
    if (!authChecked || !authenticated) return;
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      void retryIfBackOnline({
        hasPending: hasPendingUploads,
        ping: pingApi,
        uploadNow: () => syncPendingSessions({ ignoreBackoff: true }),
      });
    };
    const timer = setInterval(tick, BACK_ONLINE_RETRY_MS);
    return () => clearInterval(timer);
  }, [authChecked, authenticated]);
}
