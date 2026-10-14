import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether this account has already been shown Weekly Forge's How it works
 * (docs/product/forge-how-it-works-once-plan.md). Home opens the screen by itself only while this
 * is unset. An account preference: forgotten at sign-out (`account-preferences.ts`), so the next
 * account on the same phone gets its own first look.
 */
export const FORGE_HOW_IT_WORKS_SHOWN_STORAGE_KEY = 'forjd.forgeHowItWorksShown.v1';

/**
 * Never throws. A failed read counts as seen: an explainer that opens on every visit is worse than
 * one missed first look.
 */
export async function hasSeenForgeHowItWorks(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FORGE_HOW_IT_WORKS_SHOWN_STORAGE_KEY)) !== null;
  } catch {
    return true;
  }
}

/** Never throws: the screen still opens if the note cannot be written. */
export async function markForgeHowItWorksSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(FORGE_HOW_IT_WORKS_SHOWN_STORAGE_KEY, '1');
  } catch {
    // Nothing to do: at worst it opens once more on a later visit.
  }
}
