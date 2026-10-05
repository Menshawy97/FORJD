import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { buildLocalNotificationPlan } from './local-notification-plan-input';
import {
  cancelLocalNotifications,
  defaultLocalNotificationApi,
  reconcileLocalNotifications,
  routeForLocalNotificationTap,
  type TapLike,
} from './local-notifications';

/**
 * Keeps the phone's scheduled local notifications in step with the plan (Phase 12E, ADR-064), from the root
 * layout: reconcile at launch, whenever the app comes back to the foreground, and whenever something asks
 * (`requestLocalNotificationReconcile`: a switch changed, a workout finished, a program followed). Signed out,
 * it clears them. Fire-and-forget: the seam never throws, and a plan that could not be built (offline) leaves
 * the schedule exactly as it was.
 */
const requests = new Set<() => void>();

/** Asks the root layout to reconcile now. A no-op when no one is signed in. */
export function requestLocalNotificationReconcile(): void {
  requests.forEach((request) => request());
}

async function reconcileNow(): Promise<void> {
  const plan = await buildLocalNotificationPlan();
  if (plan) await reconcileLocalNotifications(plan);
}

/** Opens the screen a tapped FORJD notification names; every other notification is not ours to route. */
function openTapped(response: TapLike): void {
  const route = routeForLocalNotificationTap(response);
  if (route) router.push(route as Href);
}

export function useLocalNotifications(authChecked: boolean, authenticated: boolean): void {
  // The tap that launched the app is read once, so signing out and in again cannot replay it. The root layout
  // lives as long as the app does, so a ref here is once per launch.
  const launchTapChecked = useRef(false);

  useEffect(() => {
    if (!authChecked) return;
    if (!authenticated) {
      void cancelLocalNotifications();
      return;
    }
    void reconcileNow();
    requests.add(reconcileNow);
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcileNow();
    });
    const taps = defaultLocalNotificationApi.addResponseListener(openTapped);
    if (!launchTapChecked.current) {
      launchTapChecked.current = true;
      void defaultLocalNotificationApi
        .getLastResponse()
        .then((response) => {
          if (response) openTapped(response);
        })
        .catch(() => undefined);
    }
    return () => {
      requests.delete(reconcileNow);
      foreground.remove();
      taps.remove();
    };
  }, [authChecked, authenticated]);
}
