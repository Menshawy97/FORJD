import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PlannedLocalNotification } from '@forjd/domain';

import { installForegroundNotificationHandler } from '@/features/run/run-notification';

/**
 * The phone's side of the scheduled local notifications (Phase 12E, ADR-064).
 *
 * `planLocalNotifications` in `@forjd/domain` decides *what* should be scheduled for the next fortnight; this
 * module makes the phone match: it cancels every notification FORJD planned before (found by the
 * `forjd-local:` identifier prefix) and schedules the plan again. Recompute, never patch, so running it often
 * is safe and a missed trigger heals on the next one.
 *
 * Everything reaches `expo-notifications` through `LocalNotificationApi`, injected, the rest timer's seam
 * (ADR-026), so the logic is tested without the native module. Nothing here throws, asks for a permission or
 * talks to a server: it is a local schedule only (CLAUDE.md rule 6).
 */
export const LOCAL_NOTIFICATION_ID_PREFIX = 'forjd-local:';
/** A low-key channel for reminders, not the rest timer's high-importance one. */
const REMINDERS_CHANNEL_ID = 'reminders';
/** The only screens a tap on a planned notification may open. Anything else is ignored. */
const TAP_ROUTES: readonly string[] = ['/train', '/progress'];

/** The slice of `expo-notifications` the reconciler uses. */
export interface LocalNotificationApi {
  platform: string;
  getPermissionsAsync: () => Promise<{ granted: boolean }>;
  setNotificationChannelAsync: (id: string, channel: Notifications.NotificationChannelInput) => Promise<unknown>;
  getAllScheduledNotificationsAsync: () => Promise<ReadonlyArray<{ identifier: string }>>;
  scheduleNotificationAsync: (input: Notifications.NotificationRequestInput) => Promise<string>;
  cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
  /** Without a handler iOS shows nothing for a notification that arrives while the app is open. */
  installForegroundHandler: () => void;
  /** A tap on a notification while the app is running or in the background. */
  addResponseListener: (listener: (response: TapLike) => void) => { remove: () => void };
  /** The tap that launched the app from closed, if that is how it was opened. */
  getLastResponse: () => Promise<TapLike | null>;
}

export const defaultLocalNotificationApi: LocalNotificationApi = {
  platform: Platform.OS,
  getPermissionsAsync: async () => ({ granted: (await Notifications.getPermissionsAsync()).granted }),
  setNotificationChannelAsync: (id, channel) => Notifications.setNotificationChannelAsync(id, channel),
  getAllScheduledNotificationsAsync: () => Notifications.getAllScheduledNotificationsAsync(),
  scheduleNotificationAsync: (input) => Notifications.scheduleNotificationAsync(input),
  cancelScheduledNotificationAsync: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
  installForegroundHandler: installForegroundNotificationHandler,
  addResponseListener: (listener) => Notifications.addNotificationResponseReceivedListener(listener),
  getLastResponse: () => Notifications.getLastNotificationResponseAsync(),
};

// A reconcile is cancel-then-schedule, so two running together could cancel what the other just scheduled.
// They run one at a time, in the order they were asked.
let chain: Promise<unknown> = Promise.resolve();
function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function cancelPlanned(api: LocalNotificationApi): Promise<void> {
  const pending = await api.getAllScheduledNotificationsAsync();
  for (const { identifier } of pending) {
    if (identifier.startsWith(LOCAL_NOTIFICATION_ID_PREFIX)) {
      await api.cancelScheduledNotificationAsync(identifier);
    }
  }
}

/** The planned local calendar date and minute as an instant in the phone's own time zone. */
function whenOf(planned: PlannedLocalNotification): Date {
  const [year, month, day] = planned.date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, Math.floor(planned.minute / 60), planned.minute % 60);
}

/**
 * Makes the phone's scheduled notifications match `plan`. Answers how many were scheduled. With notifications
 * not allowed in the phone's settings it only clears what FORJD scheduled before: it never asks (the prompt
 * belongs where the person turns a reminder on). Never throws.
 */
export function reconcileLocalNotifications(
  plan: readonly PlannedLocalNotification[],
  api: LocalNotificationApi = defaultLocalNotificationApi,
): Promise<{ scheduled: number }> {
  return inOrder(async () => {
    try {
      await cancelPlanned(api);
      if (!(await api.getPermissionsAsync()).granted) return { scheduled: 0 };
      api.installForegroundHandler();
      if (api.platform === 'android') {
        await api.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
          name: 'Reminders',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      let scheduled = 0;
      for (const planned of plan) {
        try {
          await api.scheduleNotificationAsync({
            identifier: planned.id,
            content: { title: planned.title, body: planned.body, data: { route: planned.route } },
            trigger: {
              // Required: without a type the object is not a valid trigger and nothing is scheduled (ADR-026).
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: whenOf(planned),
              channelId: REMINDERS_CHANNEL_ID,
            },
          });
          scheduled += 1;
        } catch {
          // One that failed to schedule must not stop the rest; the next reconcile tries it again.
        }
      }
      return { scheduled };
    } catch {
      return { scheduled: 0 };
    }
  });
}

/** Cancels everything FORJD scheduled itself (signing out). Never throws. */
export function cancelLocalNotifications(api: LocalNotificationApi = defaultLocalNotificationApi): Promise<void> {
  return inOrder(async () => {
    try {
      await cancelPlanned(api);
    } catch {
      // Nothing to recover: a notification that could not be cancelled is cleared by the next reconcile.
    }
  });
}

export interface TapLike {
  notification: { request: { identifier: string; content: { data?: unknown } } };
}

/** The screen a tap on one of FORJD's planned notifications opens, or `null` for any other notification or route. */
export function routeForLocalNotificationTap(response: TapLike): string | null {
  const { identifier, content } = response.notification.request;
  if (!identifier.startsWith(LOCAL_NOTIFICATION_ID_PREFIX)) return null;
  const route = (content.data as { route?: unknown } | undefined)?.route;
  return typeof route === 'string' && TAP_ROUTES.includes(route) ? route : null;
}
