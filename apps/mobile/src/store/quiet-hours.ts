import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_QUIET_HOURS, type QuietHours } from '@forjd/domain';

// The device copy of the person's quiet hours (the quiet-hours editor, docs/product/phase-12e-plan.md). Like the
// notification switches, the server is the home of the choice (`notification-preferences-sync.ts` sends changes and
// adopts the server's answer); this is the copy the screen and the schedule read at once, and what they use offline.
//
// AsyncStorage for the same reason as `notification-preferences.ts`: two scalars, not a table, not a secret.
const STORAGE_KEY = 'forjd.quietHours.v1';
/** A change not yet sent to the server; exported so sign-out forgets it too. */
export const QUIET_HOURS_PENDING_STORAGE_KEY = 'forjd.quietHours.pending.v1';
/** Exported so sign-out can forget it. */
export const QUIET_HOURS_STORAGE_KEY = STORAGE_KEY;

const LAST_MINUTE_OF_DAY = 24 * 60 - 1;

const isMinuteOfDay = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LAST_MINUTE_OF_DAY;

/**
 * A stored or received value as a window, or `null`: two different minutes of the day. The same rule as the
 * server's contract and database check, so a window this phone keeps is one the server would accept.
 */
export function parseQuietHours(value: unknown): QuietHours | null {
  if (typeof value !== 'object' || value === null) return null;
  const { startMinute, endMinute } = value as Record<string, unknown>;
  if (!isMinuteOfDay(startMinute) || !isMinuteOfDay(endMinute) || startMinute === endMinute) return null;
  return { startMinute, endMinute };
}

/** 22:00 to 07:00 when nothing was saved or what is stored cannot be trusted. Never throws. */
export async function loadQuietHours(): Promise<QuietHours> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_QUIET_HOURS };
    return parseQuietHours(JSON.parse(raw)) ?? { ...DEFAULT_QUIET_HOURS };
  } catch {
    return { ...DEFAULT_QUIET_HOURS };
  }
}

/** Resolves `false` rather than rejecting, so a fire-and-forget caller needs no catch (like the switches' save). */
export async function saveQuietHours(hours: QuietHours): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hours));
    return true;
  } catch {
    return false;
  }
}
