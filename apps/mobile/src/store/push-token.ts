import AsyncStorage from '@react-native-async-storage/async-storage';

// The push token this install last registered with the server (Phase 12F, docs/product/phase-12f-plan.md), kept so that
// signing out can take it off the server (the server needs the sign-in to do that) and so a token registered a few days
// ago is not registered again on every launch. A token is a bearer-ish address for this phone: it stays in this file's one
// key, is never logged, and is forgotten on sign-out. AsyncStorage like the other device copies of account settings.
export const PUSH_TOKEN_STORAGE_KEY = 'forjd.pushToken.v1';

export interface StoredPushToken {
  token: string;
  /** Milliseconds since the epoch, when the server last took it. */
  registeredAt: number;
  /** The account it was registered for; a different account signing in on this phone registers it again. */
  userId?: string;
}

/** `null` when none was stored or what is stored is not a token and a time. Never throws. */
export async function loadPushToken(): Promise<StoredPushToken | null> {
  try {
    const raw = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<StoredPushToken> | null;
    if (typeof value?.token === 'string' && value.token.length > 0 && typeof value.registeredAt === 'number') {
      return {
        token: value.token,
        registeredAt: value.registeredAt,
        ...(typeof value.userId === 'string' && value.userId.length > 0 ? { userId: value.userId } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function savePushToken(value: StoredPushToken): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best effort: the worst case is registering again on the next launch.
  }
}

export async function clearPushToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // Best effort, like the other forgets on sign-out.
  }
}
