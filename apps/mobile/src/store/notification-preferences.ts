import AsyncStorage from '@react-native-async-storage/async-storage';

// Device-local notification preferences, behind a seam.
//
// There is no backend for these and won't be until push (Phase 6/8) — see
// slice2-screen-specs.md §5.7, which classes every row as (C) if FORJD Phase 1 ships without
// push. AsyncStorage is the right store for five scalars: `expo-sqlite` is a table holding
// nothing relational, MMKV needs a custom dev client (breaking the Expo Go workflow ADR-007
// depends on), and `expo-secure-store` is for secrets and is the auth layer's seam.
//
// Screens call these functions rather than AsyncStorage directly, so that moving these
// preferences server-side later is an adapter swap here, not a screen rewrite.
const STORAGE_KEY = 'forjd.notificationPreferences.v1';

export interface NotificationPreferences {
  workout: boolean;
  recovery: boolean;
  pr: boolean;
  rank: boolean;
  weekly: boolean;
}

/** slice2-screen-specs.md §5.4. `rank` (Leaderboard moves) is the one that starts off. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  workout: true,
  recovery: true,
  pr: true,
  rank: false,
  weekly: true,
};

const KEYS = Object.keys(DEFAULT_NOTIFICATION_PREFERENCES) as Array<
  keyof NotificationPreferences
>;

function isNotificationPreferences(value: unknown): value is NotificationPreferences {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return KEYS.every((key) => typeof (value as Record<string, unknown>)[key] === 'boolean');
}

/**
 * Falls back to the documented defaults both when nothing is stored and when what is stored
 * cannot be trusted — the screen has no error UI for a malformed preferences blob, and
 * degrading to the defaults is strictly better than throwing into it.
 */
export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }
    const parsed: unknown = JSON.parse(raw);
    return isNotificationPreferences(parsed) ? parsed : DEFAULT_NOTIFICATION_PREFERENCES;
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
