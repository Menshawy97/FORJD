import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A device-local copy of "the signed-in person allowed location for leaderboards" (ADR-048).
 *
 * A workout has to decide at its start, with no network, whether to read a position at all
 * (CLAUDE.md rule 6), and the real flag lives on the server. The Location screen and the Privacy
 * screen write this copy whenever they learn the truth; a workout only reads it.
 *
 * **Three states.** `true`, `false`, and `null` for "not known yet", which is what a fresh sign-in
 * looks like. `null` is what lets a workout ask the server once, in the background, instead of
 * guessing (`capture-start-location.ts`).
 *
 * **It belongs to a sign-in, not to the phone.** `clearSession` calls `forgetLocationConsent`, and
 * every way a session ends (log out, expiry, account deletion) goes through `clearSession`, so a
 * different account on the same phone never inherits the previous person's yes. (It is not keyed
 * by user id: the sign-in responses do not carry one, and nothing persists it.)
 *
 * The server stays the authority and re-checks consent on every upload, storing only the city and
 * discarding the position, so a stale copy costs little: a stale "yes" sends a coordinate the
 * server then ignores, and a stale "no" leaves a workout without a city until the person next
 * opens the Location or Privacy screen.
 *
 * Every function degrades and never throws: this sits on the path of starting a workout and inside
 * sign-out. The `forjd.` prefix means `clearLocalUserData` wipes it too on deletion.
 */
export const LOCATION_CONSENT_STORAGE_KEY = 'forjd.locationForLeaderboard.v1';

interface StoredConsent {
  enabled: boolean;
}

function isStoredConsent(value: unknown): value is StoredConsent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).enabled === 'boolean'
  );
}

/** `true` or `false` if this device has been told, `null` if it has not (or storage is unreadable). */
export async function readLocationConsent(): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_CONSENT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isStoredConsent(parsed) ? parsed.enabled : null;
  } catch {
    return null;
  }
}

export async function rememberLocationConsent(enabled: boolean): Promise<void> {
  try {
    const value: StoredConsent = { enabled };
    await AsyncStorage.setItem(LOCATION_CONSENT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Deliberately swallowed: the copy is a convenience, and failing to write it must not fail
    // the screen that just recorded the real consent on the server.
  }
}

/** Called by `clearSession`. Never throws, so sign-out cannot be stopped by it. */
export async function forgetLocationConsent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOCATION_CONSENT_STORAGE_KEY);
  } catch {
    // Deliberately swallowed, for the reason above.
  }
}
