import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { RunNotificationContent } from './run-notification-content';

/**
 * The live run notice on Android (12A-3, ADR-059, approved replica v2 2026-10-03): the run's time,
 * distance and pace under the FORJD header, with Pause (Resume) and Finish, updated in place while the
 * location foreground service keeps the app's JavaScript running with the screen off.
 *
 * **Local only** (ADR-061 decision 3): built and shown on the phone, never pushed, so it may carry the
 * run's numbers; `runNotificationContent` gives it no health value. Android only: the iPhone shows the
 * same as a Live Activity, built with Phase 11 (ADR-062).
 *
 * Everything reaches `expo-notifications` through `RunNotificationApi`, injected, the rest timer's
 * seam (ADR-026), so the logic is tested without the native module. Nothing here throws into the run.
 */
export const RUN_NOTIFICATION_ID = 'forjd-run-live';
const RUN_CHANNEL_ID = 'run-live';
const EMBER = '#E9712F';

export type RunNotificationAction = 'pause' | 'resume' | 'finish';
const ACTIONS: readonly string[] = ['pause', 'resume', 'finish'];

interface ResponseLike {
  actionIdentifier: string;
  notification: { request: { identifier: string } };
}

/** The slice of `expo-notifications` the run notice uses. */
export interface RunNotificationApi {
  platform: string;
  getPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  setNotificationChannelAsync: (id: string, channel: Notifications.NotificationChannelInput) => Promise<unknown>;
  setNotificationCategoryAsync: (id: string, actions: Notifications.NotificationAction[]) => Promise<unknown>;
  scheduleNotificationAsync: (input: Notifications.NotificationRequestInput) => Promise<string>;
  dismissNotificationAsync: (id: string) => Promise<void>;
  addNotificationResponseReceivedListener: (listener: (response: ResponseLike) => void) => { remove: () => void };
}

export const defaultRunNotificationApi: RunNotificationApi = {
  platform: Platform.OS,
  getPermissionsAsync: async () => {
    const result = await Notifications.getPermissionsAsync();
    return { granted: result.granted, canAskAgain: result.canAskAgain };
  },
  requestPermissionsAsync: async () => ({ granted: (await Notifications.requestPermissionsAsync()).granted }),
  setNotificationChannelAsync: (id, channel) => Notifications.setNotificationChannelAsync(id, channel),
  setNotificationCategoryAsync: (id, actions) => Notifications.setNotificationCategoryAsync(id, actions),
  scheduleNotificationAsync: (input) => Notifications.scheduleNotificationAsync(input),
  dismissNotificationAsync: (id) => Notifications.dismissNotificationAsync(id),
  addNotificationResponseReceivedListener: (listener) => Notifications.addNotificationResponseReceivedListener(listener),
};

const action = (identifier: string, buttonTitle: string, opensAppToForeground: boolean): Notifications.NotificationAction => ({
  identifier,
  buttonTitle,
  options: { opensAppToForeground },
});

export interface RunNotifier {
  /** Channel, action sets and permission (asked only while undecided). Whether a notice may be shown. */
  ensureReady: () => Promise<boolean>;
  show: (content: RunNotificationContent) => Promise<void>;
  clear: () => Promise<void>;
  /** Pause and Resume arrive without opening the app; Finish opens it first (owner decision). */
  onAction: (handler: (action: RunNotificationAction) => void) => () => void;
}

export function createRunNotifier(api: RunNotificationApi = defaultRunNotificationApi): RunNotifier {
  let ready = false;
  /** Bumped by every clear, so a refresh that was in flight can tell it lost the race. */
  let generation = 0;

  return {
    ensureReady: async () => {
      if (api.platform !== 'android') return false;
      try {
        await api.setNotificationChannelAsync(RUN_CHANNEL_ID, {
          name: 'Run in progress',
          // Updated every few seconds: it must never sound, buzz or pop up.
          importance: Notifications.AndroidImportance.LOW,
          sound: null,
          enableVibrate: false,
          showBadge: false,
        });
        await api.setNotificationCategoryAsync('run-running', [action('pause', 'Pause', false), action('finish', 'Finish', true)]);
        await api.setNotificationCategoryAsync('run-paused', [action('resume', 'Resume', false), action('finish', 'Finish', true)]);
        const permission = await api.getPermissionsAsync();
        const granted = permission.granted || (permission.canAskAgain && (await api.requestPermissionsAsync()).granted);
        ready = granted;
        return granted;
      } catch {
        ready = false;
        return false;
      }
    },
    show: async (content) => {
      if (!ready) return;
      const mine = generation;
      try {
        await api.scheduleNotificationAsync({
          identifier: RUN_NOTIFICATION_ID,
          content: {
            title: content.title,
            body: content.body,
            subtitle: content.header,
            categoryIdentifier: content.category,
            sticky: true,
            autoDismiss: false,
            color: EMBER,
            priority: 'low',
            data: { forjdOngoing: true },
          },
          trigger: { channelId: RUN_CHANNEL_ID },
        });
        // Cleared while this was posting: posting landed after the dismiss, so a sticky notice would
        // otherwise stay on a phone whose run is over. Take it down again.
        if (mine !== generation) await api.dismissNotificationAsync(RUN_NOTIFICATION_ID);
      } catch {
        // A missed update is a few stale seconds on the lock screen, not a broken run.
      }
    },
    clear: async () => {
      ready = false;
      generation += 1;
      try {
        await api.dismissNotificationAsync(RUN_NOTIFICATION_ID);
      } catch {
        // Nothing to dismiss.
      }
    },
    onAction: (handler) => {
      const subscription = api.addNotificationResponseReceivedListener((response) => {
        if (response.notification.request.identifier !== RUN_NOTIFICATION_ID) return;
        if (!ACTIONS.includes(response.actionIdentifier)) return;
        handler(response.actionIdentifier as RunNotificationAction);
      });
      return () => subscription.remove();
    },
  };
}

export const runNotifier = createRunNotifier();

/**
 * Takes down a run notice left over from an app that was closed mid-run (emulator walk finding 12). The notice is
 * sticky, so Android kept it with Pause and Finish that no longer did anything. Called once at app start, when no run
 * is live yet: a run picked back up posts its own. Leaves `runNotifier`'s own state alone, so it can still post.
 */
export async function dismissStaleRunNotice(api: RunNotificationApi = defaultRunNotificationApi): Promise<void> {
  try {
    await api.dismissNotificationAsync(RUN_NOTIFICATION_ID);
  } catch {
    // Nothing to take down.
  }
}

/**
 * How a notification shows while the app is open. The ongoing run notice is updated every few seconds,
 * so it must stay silent and out of the banner; everything else (rest complete) shows and sounds.
 */
export function foregroundPresentation(data: Record<string, unknown> | undefined): Notifications.NotificationBehavior {
  const ongoing = data?.forjdOngoing === true;
  return { shouldPlaySound: !ongoing, shouldSetBadge: false, shouldShowBanner: !ongoing, shouldShowList: true };
}

/** The app's one foreground handler, shared by the rest timer and the run notice. Idempotent. */
export function installForegroundNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) =>
      foregroundPresentation(notification.request.content.data as Record<string, unknown> | undefined),
  });
}
