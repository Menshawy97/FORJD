import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * The rest-timer notification (Phase 3H, slice H4, ADR-026).
 *
 * A phone spends most of a rest period locked in a pocket. The rest screen's countdown is
 * wall-clock based so it is *correct* when the athlete looks again, but correct is not the same
 * as useful: without a notification they have to keep checking. This schedules a local one for
 * the moment rest ends, and cancels it if they skip early.
 *
 * **Everything reaches `expo-notifications` through this module**, and every function takes its
 * dependency injected -- the same seam `exercise-catalogue.ts` uses for `expo-sqlite`. That is
 * what keeps the rest screen testable: `expo-notifications` has no JS implementation under
 * Jest, so a screen calling it directly could not be rendered in a test at all.
 *
 * **Local notifications only.** Nothing here registers for push, requests a device token, or
 * talks to a server -- so it adds no new network dependency to the live flow (CLAUDE.md rule 6)
 * and no new privacy surface.
 */

/** The Android channel rest alerts are delivered on. Android drops a notification with no channel. */
const REST_CHANNEL_ID = 'workout-rest';

/**
 * The slice of `expo-notifications` this module actually uses.
 *
 * **The trigger must carry its `type`.** `expo-notifications` 0.32 requires every object trigger
 * to name one of `SchedulableTriggerInputTypes`; a bare `{ seconds }` is not a valid trigger and
 * schedules nothing at all. Typing this as the library's own `NotificationRequestInput` rather
 * than a hand-written shape is deliberate: the first version of this file described the input
 * loosely and then cast it with `as unknown as`, which silenced the exact compile error that
 * would have caught the missing `type`. It shipped, Jest passed, and the phone stayed silent
 * through a locked-screen rest — the one thing only a device walk could reveal.
 */
export interface NotificationScheduler {
  getPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  scheduleNotificationAsync: (input: Notifications.NotificationRequestInput) => Promise<string>;
  cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
  /** No-op on iOS; on Android a channel must exist before anything is delivered. */
  ensureChannel: () => Promise<void>;
}

export const defaultScheduler: NotificationScheduler = {
  getPermissionsAsync: async () => {
    const result = await Notifications.getPermissionsAsync();
    return { granted: result.granted, canAskAgain: result.canAskAgain };
  },
  requestPermissionsAsync: async () => {
    const result = await Notifications.requestPermissionsAsync();
    return { granted: result.granted };
  },
  scheduleNotificationAsync: (input) => Notifications.scheduleNotificationAsync(input),
  cancelScheduledNotificationAsync: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
  ensureChannel: async () => {
    /**
     * Without a handler, iOS shows *nothing* for a notification that arrives while the app is
     * in the foreground — it is delivered silently to the app instead. The athlete watching the
     * rest countdown would see no alert and reasonably call it broken, which is the same
     * complaint as a silent locked screen for a different reason. Idempotent, so setting it
     * before each schedule is free.
     */
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    if (Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(REST_CHANNEL_ID, {
      name: 'Rest timer',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      // The point of the alert is to be noticed with the phone face-down in a gym bag.
      vibrationPattern: [0, 250, 250, 250],
    });
  },
};

/**
 * Asks for permission **only if it has not been decided already** -- the athlete meets this
 * prompt at their first rest, mid-workout, where the reason is obvious, rather than during a
 * launch sequence where it has no context. That placement is
 * `rules/ecc/react-native/security.md`'s rule ("minimum permissions, at the moment they are
 * needed") applied literally.
 *
 * Returns whether a notification may be scheduled. A refusal is not an error: the countdown on
 * screen keeps working, and nothing re-prompts.
 */
export async function ensureRestNotificationPermission(
  scheduler: NotificationScheduler = defaultScheduler,
): Promise<boolean> {
  try {
    const current = await scheduler.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const requested = await scheduler.requestPermissionsAsync();
    return requested.granted;
  } catch {
    // A permissions failure must never take the rest screen down with it.
    return false;
  }
}

/**
 * Schedules the "rest is over" notification. Returns its identifier so it can be cancelled, or
 * `null` if it was not scheduled -- permission refused, a non-positive delay, or a failure.
 */
export async function scheduleRestEndNotification(
  seconds: number,
  scheduler: NotificationScheduler = defaultScheduler,
): Promise<string | null> {
  if (seconds <= 0) return null;
  const permitted = await ensureRestNotificationPermission(scheduler);
  if (!permitted) return null;
  try {
    await scheduler.ensureChannel();
    return await scheduler.scheduleNotificationAsync({
      content: {
        title: 'Rest complete',
        body: 'Time for your next set.',
        sound: true,
        // Delivered while the phone is locked, so it has to be worth feeling, not just seeing.
        vibrate: [0, 250, 250, 250],
      },
      trigger: {
        // Required. Without it the object is not a valid trigger and nothing is scheduled.
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
        repeats: false,
        channelId: REST_CHANNEL_ID,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Cancels a scheduled notification. Safe to call with `null` and safe to call twice, because
 * the rest screen can leave by several routes -- expiry, Skip Rest, the hardware back button --
 * and a notification firing after the athlete is already back on the next set is worse than no
 * notification at all.
 */
export async function cancelRestEndNotification(
  identifier: string | null,
  scheduler: NotificationScheduler = defaultScheduler,
): Promise<void> {
  if (!identifier) return;
  try {
    await scheduler.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Already fired or already cancelled -- nothing to recover from.
  }
}
