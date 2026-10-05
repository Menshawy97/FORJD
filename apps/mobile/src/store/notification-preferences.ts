import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_NOTIFICATION_PREFERENCES as DOMAIN_DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  type NotificationPreferences as DomainNotificationPreferences,
} from '@forjd/domain';

// The device copy of the notification switches, behind a seam.
//
// Since Phase 12D the server is the home of these (`store/notification-preferences-sync.ts` sends
// changes and adopts the server's answer); this is the cache the screen reads at once, and what it
// shows offline. It was device-local only before that, see slice2-screen-specs.md §5.7.
//
// AsyncStorage is the right store for five scalars: `expo-sqlite` is a table holding nothing
// relational, MMKV needs a custom dev client (breaking the Expo Go workflow ADR-007 depends on), and
// `expo-secure-store` is for secrets and is the auth layer's seam.
//
// Screens call these functions rather than AsyncStorage directly, so the server sync could be added
// beside them without a screen rewrite.
const STORAGE_KEY = 'forjd.notificationPreferences.v1';
/** Exported so sign-out can forget it (whole-app review 8.5, L5-2). */
export const NOTIFICATION_PREFERENCES_STORAGE_KEY = STORAGE_KEY;

export type NotificationPreferences = DomainNotificationPreferences;

/** slice2-screen-specs.md §5.4, from `@forjd/domain` so the API and the phone share one copy. `rank` is the one that starts off. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = DOMAIN_DEFAULT_NOTIFICATION_PREFERENCES;

/** Changes not yet sent to the server (Phase 12D); exported so sign-out forgets them too. */
export const NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY = 'forjd.notificationPreferences.pending.v1';

const KEYS = NOTIFICATION_PREFERENCE_KEYS;

/**
 * Each switch is taken from what is stored when it is a boolean and from the defaults when it is not, so a copy
 * saved by an older build (five switches, before the 12E reminders) keeps every choice it made and gets the
 * newer ones at their defaults. A stored value that is not an object at all is not trusted.
 */
function readStoredPreferences(value: unknown): NotificationPreferences {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  const stored = value as Record<string, unknown>;
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const key of KEYS) {
    const entry = stored[key];
    if (typeof entry === 'boolean') preferences[key] = entry;
  }
  return preferences;
}

/**
 * Falls back to the documented defaults both when nothing is stored and when what is stored
 * cannot be trusted (a switch that is not a boolean is read as its default) — the screen has no error UI for a malformed preferences blob, and
 * degrading to the defaults is strictly better than throwing into it.
 */
export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }
    return readStoredPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

/**
 * Resolves even when the write fails, rather than rejecting into a fire-and-forget call site.
 *
 * This is a deliberate swallow, not an accidental one: `notifs` has no Save button and no
 * error surface for a preference write, so a rejection there would become an unhandled
 * promise rejection while the UI already shows the new state. Returning `false` lets a caller
 * that *does* care react, without forcing one that doesn't to wire up a catch.
 */
export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}
