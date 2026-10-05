import AsyncStorage from '@react-native-async-storage/async-storage';

// The day the monthly weigh-in reminder starts counting from when there is no body scan to count from (Phase
// 12E-8): the day the switch was first turned on. A local date, nothing about the body. Kept on the phone,
// forgotten when the switch is turned off and on sign-out (`account-preferences.ts`).
export const WEIGH_IN_SINCE_STORAGE_KEY = 'forjd.weighInReminder.since.v1';

const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * The stored day, or `today` (kept for next time) when there is none. Never throws: storage that fails
 * counts from today, which only means the reminder starts a month from now.
 */
export async function getOrSetWeighInSince(today: string): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(WEIGH_IN_SINCE_STORAGE_KEY);
    if (stored !== null && LOCAL_DATE.test(stored)) return stored;
    await AsyncStorage.setItem(WEIGH_IN_SINCE_STORAGE_KEY, today);
  } catch {
    // Counting from today is the safe answer; the next reconcile tries to keep it again.
  }
  return today;
}

/** Forgets the day, so turning the reminder on again starts a fresh month. Never throws. */
export async function clearWeighInSince(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WEIGH_IN_SINCE_STORAGE_KEY);
  } catch {
    // Best effort: a stale day only brings the next reminder a little sooner.
  }
}
