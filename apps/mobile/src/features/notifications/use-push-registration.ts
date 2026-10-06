import { useEffect } from 'react';
import { AppState } from 'react-native';

import { syncPushRegistration } from './push-registration';

/**
 * Keeps this install's push registration in step with what the person wants (Phase 12F, docs/product/phase-12f-plan.md),
 * from the root layout: at launch once signed in, whenever the app comes back to the front, and whenever something asks
 * (`requestPushRegistrationSync`: a push switch changed, the phone just allowed notifications). Signed out it does
 * nothing: taking the token off the server needs the sign-in, so that happens in the log-out handler, before the
 * session is cleared. Fire-and-forget: the sync never throws, and a phone without push set up just does not register.
 */
const requests = new Set<() => void>();

/** Asks the root layout to sync now. A no-op when no one is signed in. */
export function requestPushRegistrationSync(): void {
  requests.forEach((request) => request());
}

const syncNow = (): void => {
  void syncPushRegistration();
};

export function usePushRegistration(authChecked: boolean, authenticated: boolean): void {
  useEffect(() => {
    if (!authChecked || !authenticated) return;
    syncNow();
    requests.add(syncNow);
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncNow();
    });
    return () => {
      requests.delete(syncNow);
      foreground.remove();
    };
  }, [authChecked, authenticated]);
}
