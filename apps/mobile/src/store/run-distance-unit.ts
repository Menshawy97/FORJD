import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The phone's copy of the Units distance choice (kilometres or miles), so a run shows miles without signal
 * (docs/product/run-miles-plan.md, rule 6). The server's profile is the truth; this copy is written when the signed-in
 * app reads the profile at launch and when Units is saved. An account preference: forgotten at sign-out
 * (`account-preferences.ts`).
 */
export const RUN_DISTANCE_UNIT_STORAGE_KEY = 'forjd.runDistanceUnit.v1';

export type RunDistanceUnit = 'km' | 'mi';

/** Kilometres when nothing is kept, the copy is unreadable, or the read fails. Never throws. */
export async function loadRunDistanceUnit(): Promise<RunDistanceUnit> {
  try {
    return (await AsyncStorage.getItem(RUN_DISTANCE_UNIT_STORAGE_KEY)) === 'mi' ? 'mi' : 'km';
  } catch {
    return 'km';
  }
}

/** Never throws: a run falls back to kilometres rather than failing over a display preference. */
export async function saveRunDistanceUnit(unit: RunDistanceUnit): Promise<void> {
  try {
    await AsyncStorage.setItem(RUN_DISTANCE_UNIT_STORAGE_KEY, unit);
  } catch {
    // The next profile read writes it again.
  }
}
