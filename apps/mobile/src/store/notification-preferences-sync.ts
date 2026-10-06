import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationPreferencesResponseSchema, quietHoursSchema } from '@forjd/contracts';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  type NotificationPreferences,
  type QuietHours,
} from '@forjd/domain';

import { getNotificationPreferences, patchNotificationPreferences } from '@/auth/apiClient';
import { NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY, saveNotificationPreferences } from './notification-preferences';
import { parseQuietHours, QUIET_HOURS_PENDING_STORAGE_KEY, saveQuietHours } from './quiet-hours';

// An older server answers no quiet hours; the switches in its answer still count (the quiet-hours editor, slice 3).
const serverAnswerSchema = notificationPreferencesResponseSchema.extend({ quietHours: quietHoursSchema.optional() });

// Phase 12D (docs/product/phase-12d-plan.md). The device copy in `notification-preferences.ts` stays
// the cache the screen reads at once. This module makes the server the home of the choice:
//
// - `queueNotificationChange` sends only the switch that changed, so a stale phone can only
//   overwrite the one switch it touched, never the other four.
// - A change that cannot be sent is kept (survives an app restart) and sent the next time the
//   screen opens.
// - `syncNotificationPreferences` sends anything waiting, then adopts the server's answer: the
//   server wins (owner decision, 2026-10-05), so every device shows the same thing.
//
// The switches are never in the critical path of a workout (CLAUDE.md rule 6), so nothing here
// throws and nothing shows an error: a failure leaves the device copy as it was.
// The key lives in `notification-preferences.ts` so sign-out can forget it without importing this module,
// which imports the API client (a cycle through secure storage). Re-exported here for the callers and tests.
const PENDING_KEY = NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY;
export { NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY };

type PendingChanges = Partial<NotificationPreferences>;

// The screen fires a change without waiting, so two quick taps (or a tap during a send or a sync) would run
// together and the later read-modify-write could overwrite the earlier. Everything that reads or writes the
// pending changes or the device copy runs one at a time, in the order it was asked.
let chain: Promise<unknown> = Promise.resolve();
function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function readPending(): Promise<PendingChanges> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const pending: PendingChanges = {};
    for (const key of NOTIFICATION_PREFERENCE_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') pending[key] = value;
    }
    return pending;
  } catch {
    return {};
  }
}

async function writePending(pending: PendingChanges): Promise<void> {
  try {
    if (Object.keys(pending).length === 0) {
      await AsyncStorage.removeItem(PENDING_KEY);
    } else {
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    }
  } catch {
    // Best effort: a change that cannot be remembered is still on the device copy.
  }
}

/**
 * Sends everything waiting. After a successful send it forgets only what it sent, and only if the
 * value is still the one it sent, so a switch tapped while the request was in flight is kept.
 */
async function flushPending(): Promise<boolean> {
  const sent = await readPending();
  if (Object.keys(sent).length === 0) return true;
  try {
    await patchNotificationPreferences(sent);
  } catch {
    return false;
  }
  const now = await readPending();
  const remaining: PendingChanges = {};
  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    if (now[key] !== undefined && now[key] !== sent[key]) remaining[key] = now[key];
  }
  await writePending(remaining);
  return true;
}

/** Records what changed between two states of the switches, then tries to send it. Never throws. */
export function queueNotificationChange(
  previous: NotificationPreferences,
  next: NotificationPreferences,
): Promise<void> {
  return inOrder(() => queueInOrder(previous, next));
}

async function queueInOrder(previous: NotificationPreferences, next: NotificationPreferences): Promise<void> {
  try {
    // Saved here as well as by the screen, so a server answer that was already on its way cannot leave
    // the device copy older than the tap (the sync runs before this, in order, then this wins).
    await saveNotificationPreferences(next);
    const changed: PendingChanges = {};
    for (const key of NOTIFICATION_PREFERENCE_KEYS) {
      if (previous[key] !== next[key]) changed[key] = next[key];
    }
    if (Object.keys(changed).length === 0) return;
    await writePending({ ...(await readPending()), ...changed });
    await flushPending();
  } catch {
    // The device copy already has the change; it is sent the next time the screen opens.
  }
}

async function readPendingQuietHours(): Promise<QuietHours | null> {
  try {
    const raw = await AsyncStorage.getItem(QUIET_HOURS_PENDING_STORAGE_KEY);
    return raw === null ? null : parseQuietHours(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writePendingQuietHours(hours: QuietHours | null): Promise<void> {
  try {
    if (hours === null) {
      await AsyncStorage.removeItem(QUIET_HOURS_PENDING_STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(QUIET_HOURS_PENDING_STORAGE_KEY, JSON.stringify(hours));
    }
  } catch {
    // Best effort, like the switches: the device copy already has the window.
  }
}

const sameWindow = (a: QuietHours | null, b: QuietHours | null): boolean =>
  a !== null && b !== null && a.startMinute === b.startMinute && a.endMinute === b.endMinute;

/**
 * Sends a quiet-hours change that is waiting, whole (both times). Forgets it only if it is still the one that was
 * sent, so a newer choice made meanwhile is kept for the next send.
 */
async function flushPendingQuietHours(): Promise<boolean> {
  const sent = await readPendingQuietHours();
  if (sent === null) return true;
  try {
    await patchNotificationPreferences({ quietHours: sent });
  } catch {
    return false;
  }
  if (sameWindow(await readPendingQuietHours(), sent)) await writePendingQuietHours(null);
  return true;
}

/**
 * Keeps a chosen quiet-hours window on the phone at once, then tries to send it. Never throws: a window that cannot
 * be sent is kept and sent the next time the Notifications screen opens, like a switch.
 */
export function queueQuietHoursChange(hours: QuietHours): Promise<void> {
  return inOrder(async () => {
    try {
      await saveQuietHours(hours);
      await writePendingQuietHours(hours);
      await flushPendingQuietHours();
    } catch {
      // The device copy already has the window; it is sent the next time the screen opens.
    }
  });
}

/**
 * Sends anything waiting, then reads the server's switches and keeps them as the device copy; the server's quiet
 * hours, when it sends them, become the device copy too.
 * Answers the switches, or `null` when it could not (offline, a send that failed, an answer that is
 * not the contract), in which case the device copy is left exactly as it was.
 */
export function syncNotificationPreferences(): Promise<NotificationPreferences | null> {
  return inOrder(syncInOrder);
}

async function syncInOrder(): Promise<NotificationPreferences | null> {
  try {
    if (!(await flushPending()) || !(await flushPendingQuietHours())) return null;
    const parsed = serverAnswerSchema.safeParse(await getNotificationPreferences());
    if (!parsed.success) return null;
    const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    for (const key of NOTIFICATION_PREFERENCE_KEYS) preferences[key] = parsed.data[key];
    await saveNotificationPreferences(preferences);
    if (parsed.data.quietHours) await saveQuietHours(parsed.data.quietHours);
    return preferences;
  } catch {
    return null;
  }
}
