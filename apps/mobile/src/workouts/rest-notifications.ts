import * as Notifications from 'expo-notifications';

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

/** The slice of `expo-notifications` this module actually uses. */
export interface NotificationScheduler {
  getPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  scheduleNotificationAsync: (input: {
    content: { title: string; body: string; sound?: boolean };
    trigger: { seconds: number } | null;
  }) => Promise<string>;
  cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
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
  scheduleNotificationAsync: (input) =>
    Notifications.scheduleNotificationAsync(input as unknown as Notifications.NotificationRequestInput),
  cancelScheduledNotificationAsync: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
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
    return await scheduler.scheduleNotificationAsync({
      content: {
        title: 'Rest complete',
        body: 'Time for your next set.',
        sound: true,
      },
      trigger: { seconds },
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
