import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether the run has already asked Android's Health Connect for heart rate and calories. **It asks
 * once, on the first run, and never again** (the person's decision, R8): later runs only read, and if
 * the person said no, or later revoked access in Health Connect, that is theirs to change there.
 *
 * Device-wide rather than per sign-in, because the permission itself belongs to this app on this
 * phone, not to an account. Unreadable storage reads as "not asked", so a broken disk can cost a
 * repeat prompt but never a silently skipped request.
 */
export const RUN_HEALTH_ASKED_STORAGE_KEY = 'forjd.runHealthAccessAsked.v1';

export async function hasAskedRunHealthAccess(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(RUN_HEALTH_ASKED_STORAGE_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markRunHealthAccessAsked(): Promise<void> {
  try {
    await AsyncStorage.setItem(RUN_HEALTH_ASKED_STORAGE_KEY, '1');
  } catch {
    // Worst case the person is asked once more.
  }
}
