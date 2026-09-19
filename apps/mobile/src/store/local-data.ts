import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteExerciseCatalogueDb } from './exercise-catalogue';
import { deleteWorkoutSessionDb } from './workout-session';

const STORAGE_KEY_PREFIX = 'forjd.';

/**
 * Wipes everything FORJD keeps on this device for the signed-in person: the offline workout
 * log and upload queue, the exercise catalogue cache, and the `forjd.*` preference keys.
 * Called once account deletion succeeds (and when an underage sign-up is turned away), so a
 * deleted account leaves nothing readable behind on a shared or resold phone.
 *
 * Best effort by design: the server has already erased the account, so a step that fails
 * here (a locked file, a missing database) is not worth stranding the user on the delete
 * screen -- each step is attempted independently and nothing is thrown.
 */
export async function clearLocalUserData(): Promise<void> {
  await attempt(deleteWorkoutSessionDb);
  await attempt(deleteExerciseCatalogueDb);
  await attempt(async () => {
    const keys = await AsyncStorage.getAllKeys();
    const own = keys.filter((key) => key.startsWith(STORAGE_KEY_PREFIX));
    if (own.length > 0) {
      await AsyncStorage.multiRemove(own);
    }
  });
}

async function attempt(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch {
    // Deliberately swallowed -- see the docblock above.
  }
}
