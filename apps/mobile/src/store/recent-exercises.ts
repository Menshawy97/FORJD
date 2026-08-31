import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Backs the library screen's `Recent` section (Phase I) with genuine recency, not the
 * prototype's `all.slice(0,3)` stand-in — `docs/design/phase2-screen-specs.md` §3.1 and §8
 * both call this out as a deliberate correction, not a fidelity break. AsyncStorage, not
 * SQLite: this is three scalars' worth of ids, the same "AsyncStorage is right for a handful
 * of values" case `notification-preferences.ts`'s own comment describes, not the relational
 * catalogue `exercise-catalogue.ts` exists for.
 *
 * Nothing populates this list yet — recording an "opened" event belongs to the exercise
 * detail screen (Phase J), which does not exist beyond a routing placeholder today. Until
 * then `getRecentExerciseIds` correctly returns `[]` and the library screen's `Recent`
 * section correctly renders nothing (`lbl`, "rendered only when non-empty" — §3.5), rather
 * than showing a stand-in.
 */
const STORAGE_KEY = 'forjd.recentExercises.v1';
const MAX_RECENT = 3;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Falls back to `[]` on anything malformed, the same "degrade, don't throw" choice notification-preferences.ts makes. */
export async function getRecentExerciseIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Most-recently-opened first, deduplicated (re-opening an exercise moves it to the front
 * rather than appearing twice), capped at `MAX_RECENT` — matching the prototype's own
 * three-row `Recent` section, which this replaces the data source for without changing the
 * shape a screen renders.
 */
export async function recordExerciseOpened(id: string): Promise<boolean> {
  try {
    const current = await getRecentExerciseIds();
    const next = [id, ...current.filter((existing) => existing !== id)].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
