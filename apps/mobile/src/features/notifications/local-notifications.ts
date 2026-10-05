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
const TAP_ROUTES: readonly string[] = ['/train', '/progress', '/nutrition', '/', '/inbody'];

/** The slice of `expo-notifications` the reconciler uses. */
export interface LocalNotificationApi {
  platform: string;
  getPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
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
  getPermissionsAsync: async () => {
    const result = await Notifications.getPermissionsAsync();
    return { granted: result.granted, canAskAgain: result.canAskAgain };
  },
  requestPermissionsAsync: async () => ({ granted: (await Notifications.requestPermissionsAsync()).granted }),
  setNotificationChannelAsync: (id, channel) => Notifications.setNotificationChannelAsync(id, channel),
  getAllScheduledNotificationsAsync: () => Notifications.getAllScheduledNotificationsAsync(),
  scheduleNotificationAsync: (input) => Notifications.scheduleNotificationAsync(input),
  cancelScheduledNotificationAsync: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
  installForegroundHandler: installForegroundNotificationHandler,
  addResponseListener: (listener) => Notifications.addNotificationResponseReceivedListener(listener),
  getLastResponse: () => Notifications.getLastNotificationResponseAsync(),
};

// Reconciles and cancels run one at a time, in the order they were asked, and the plan is read *inside* the
// queue: a plan read outside it finishes in whatever order its network calls do, so an older, slower read could
// land after a newer one (a switch turned off, a sign-out) and put back what had just been cleared. Each ask
// also supersedes the ones queued before it: a request that is no longer the latest when its turn comes is
// skipped, because the latest one will read fresher facts anyway.
let chain: Promise<unknown> = Promise.resolve();
let latestAsk = 0;
function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function listPlannedIds(api: LocalNotificationApi): Promise<string[]> {
  const pending = await api.getAllScheduledNotificationsAsync();
  return pending.map(({ identifier }) => identifier).filter((identifier) => identifier.startsWith(LOCAL_NOTIFICATION_ID_PREFIX));
}

/** Cancels FORJD's planned notifications except those in `keep`. One that fails to cancel does not stop the rest. */
async function cancelPlanned(api: LocalNotificationApi, keep: ReadonlySet<string> = new Set()): Promise<void> {
  for (const identifier of await listPlannedIds(api)) {
    if (keep.has(identifier)) continue;
    try {
      await api.cancelScheduledNotificationAsync(identifier);
    } catch {
      // Already fired or already gone; the next reconcile looks again.
    }
  }
}

/** The planned local calendar date and minute as an instant in the phone's own time zone. */
function whenOf(planned: PlannedLocalNotification): Date {
  const [year, month, day] = planned.date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, Math.floor(planned.minute / 60), planned.minute % 60);
}

/** Android only. A notification needs its channel to exist, and Android 13 and later need one before the permission dialog. */
async function ensureChannel(api: LocalNotificationApi): Promise<void> {
  if (api.platform !== 'android') return;
  await api.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function scheduleAll(plan: readonly PlannedLocalNotification[], api: LocalNotificationApi): Promise<number> {
  api.installForegroundHandler();
  await ensureChannel(api);
  let scheduled = 0;
  for (const planned of plan) {
    try {
      // The identifier is deterministic, so scheduling one that already exists replaces it in place.
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
  return scheduled;
}

/**
 * Makes the phone's scheduled notifications match the plan `readPlan` answers, read when this ask's turn comes
 * (a `null` means it could not be built, e.g. offline: the schedule is left exactly as it was). Answers how many
 * were scheduled. The new plan is scheduled first and only then are stale ones cancelled, so a failure part-way
 * never leaves the person with nothing. With notifications not allowed in the phone's settings it only clears
 * what FORJD scheduled before: it never asks (the prompt belongs where the person turns a reminder on).
 * Never throws.
 */
export function reconcileLocalNotifications(
  readPlan: () => Promise<PlannedLocalNotification[] | null>,
  api: LocalNotificationApi = defaultLocalNotificationApi,
): Promise<{ scheduled: number }> {
  const ask = ++latestAsk;
  return inOrder(async () => {
    if (ask !== latestAsk) return { scheduled: 0 };
    try {
      const plan = await readPlan();
      if (plan === null) return { scheduled: 0 };
      if (!(await api.getPermissionsAsync()).granted) {
        await cancelPlanned(api);
        return { scheduled: 0 };
      }
      const scheduled = await scheduleAll(plan, api);
      // A plan that could not be scheduled at all means the scheduler is failing, so what is already there stays.
      if (plan.length === 0 || scheduled > 0) await cancelPlanned(api, new Set(plan.map((planned) => planned.id)));
      return { scheduled };
    } catch {
      return { scheduled: 0 };
    }
  });
}

/** Cancels everything FORJD scheduled itself (signing out), and supersedes any reconcile still waiting. Never throws. */
export function cancelLocalNotifications(api: LocalNotificationApi = defaultLocalNotificationApi): Promise<void> {
  latestAsk += 1;
  return inOrder(async () => {
    try {
      await cancelPlanned(api);
    } catch {
      // Nothing to recover: a notification that could not be listed is cleared by the next reconcile.
    }
  });
}

export type NotificationPermission = 'granted' | 'undetermined' | 'denied';

/**
 * Whether the phone lets FORJD show notifications: allowed, not asked yet (so the prompt can still appear), or
 * refused for good (only the phone's settings can change it, which is when the screen shows its note). Android 13
 * and later report "can ask again" after a first refusal, so the screen also treats a refusal it has just seen as
 * one. A read that fails counts as not asked, never as an error.
 */
export async function readNotificationPermission(
  api: LocalNotificationApi = defaultLocalNotificationApi,
): Promise<NotificationPermission> {
  try {
    const { granted, canAskAgain } = await api.getPermissionsAsync();
    if (granted) return 'granted';
    return canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}

/**
 * Asks for the permission only if the phone has not decided yet. Called where the person turns a reminder on, so
 * the prompt appears at the moment its reason is obvious (the reconciler itself never asks). Answers whether
 * notifications are now allowed. Never throws.
 */
export async function ensureLocalNotificationPermission(
  api: LocalNotificationApi = defaultLocalNotificationApi,
): Promise<boolean> {
  try {
    const { granted, canAskAgain } = await api.getPermissionsAsync();
    if (granted) return true;
    if (!canAskAgain) return false;
    try {
      await ensureChannel(api);
    } catch {
      // Ask anyway: on a phone that does not need the channel first the dialog still appears.
    }
    return (await api.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
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
