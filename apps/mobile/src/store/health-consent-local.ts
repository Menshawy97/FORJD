import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A device-local copy of "the signed-in person allowed health data" (ADR-043), for the same reason
 * `leaderboard-consent.ts` keeps one for location (ADR-048): a run decides at its start, with no
 * network (CLAUDE.md rule 6), whether it may read a watch's heart rate. The real flag is on the
 * server, which stays the authority and drops health fields it should not keep. The Health consent
 * and Privacy screens and Home write this copy whenever they learn the truth; a run only reads it.
 *
 * `true`, `false`, and `null` for "not known" (a fresh sign-in, or an unreadable value). **Only an
 * explicit `true` ever allows a read**: unknown is treated as no. It belongs to a sign-in:
 * `clearSession` forgets it, so a different account on the same phone never inherits a yes. Every
 * function degrades and never throws, so it cannot stop a run or a sign-out.
 */
export const HEALTH_CONSENT_STORAGE_KEY = 'forjd.healthDataConsent.v1';

const isStored = (value: unknown): value is { enabled: boolean } =>
  typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).enabled === 'boolean';

export async function readHealthConsent(): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(HEALTH_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStored(parsed) ? parsed.enabled : null;
  } catch {
    return null;
  }
}

export async function rememberHealthConsent(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(HEALTH_CONSENT_STORAGE_KEY, JSON.stringify({ enabled }));
  } catch {
    // A convenience copy: failing to write it must not fail the screen that recorded the real consent.
  }
}

/** Called by `clearSession`. Never throws, so sign-out cannot be stopped by it. */
export async function forgetHealthConsent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HEALTH_CONSENT_STORAGE_KEY);
  } catch {
    // Deliberately swallowed, for the reason above.
  }
}
