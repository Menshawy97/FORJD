import AsyncStorage from '@react-native-async-storage/async-storage';

import { EXERCISE_UNITS_STORAGE_KEY } from './exercise-unit-preferences';
import {
  NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY,
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
} from './notification-preferences';
import { PUSH_TOKEN_STORAGE_KEY } from './push-token';
import { QUIET_HOURS_PENDING_STORAGE_KEY, QUIET_HOURS_STORAGE_KEY } from './quiet-hours';
import { RECENT_EXERCISES_STORAGE_KEY } from './recent-exercises';
import { TIME_ZONE_SENT_STORAGE_KEY, forgetTimeZoneSent } from './time-zone-sent';
import { WEIGH_IN_SINCE_STORAGE_KEY } from './weigh-in-reminder-anchor';

/**
 * The device preferences that belong to one signed-in person, not to the phone (whole-app review
 * 8.5, L5-2): what they opened recently, their notification toggles, their per-exercise units,
 * and the time zone last sent for Weekly Forge (so the next account sends its own).
 * Forgotten on every sign-out so the next account on the same phone starts clean.
 *
 * Not in this list, deliberately: the location and health consent copies (forgotten by their own
 * modules, `clearSession` calls both), and whether the run screen has already asked for Health
 * Connect access, which is a permission of the phone and the app rather than of an account.
 */
const ACCOUNT_PREFERENCE_KEYS = [
  RECENT_EXERCISES_STORAGE_KEY,
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
  NOTIFICATION_PREFERENCES_PENDING_STORAGE_KEY,
  QUIET_HOURS_STORAGE_KEY,
  QUIET_HOURS_PENDING_STORAGE_KEY,
  PUSH_TOKEN_STORAGE_KEY,
  EXERCISE_UNITS_STORAGE_KEY,
  TIME_ZONE_SENT_STORAGE_KEY,
  WEIGH_IN_SINCE_STORAGE_KEY,
] as const;

/** Never throws: a preference that fails to clear must not stop a sign-out. */
export async function forgetAccountPreferences(): Promise<void> {
  forgetTimeZoneSent();
  await Promise.all(
    ACCOUNT_PREFERENCE_KEYS.map(async (key) => {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // Best effort, like the consent copies: the sign-out itself matters more.
      }
    }),
  );
}
