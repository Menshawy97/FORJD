// The only module in the app allowed to import expo-secure-store — enforced by
// scripts/ci/check-architecture-conformance.sh and by
// src/auth/__tests__/secureStorage.test.ts. Every other module reads/writes a session
// through the functions exported here.
//
// Per ADR-011 (ported from flutter_secure_storage to expo-secure-store, see ADR-013):
// tokens live under five `forjd.`-prefixed keys and are cached in memory after first read,
// because the interceptor in src/auth/apiClient.ts reads on every outgoing request and a
// keystore round trip per request is a real cost on Android. The cache is written through
// on every mutation, so it can never serve a token the store no longer holds.
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  accessToken: 'forjd.accessToken',
  refreshToken: 'forjd.refreshToken',
  expiresAt: 'forjd.expiresAt',
  userId: 'forjd.userId',
  email: 'forjd.email',
} as const;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface SessionIdentity {
  userId?: string;
  email?: string;
}

interface Cache {
  accessToken: string | null | undefined;
  refreshToken: string | null | undefined;
  expiresAt: string | null | undefined;
  userId: string | null | undefined;
  email: string | null | undefined;
}

// `undefined` means "not read from the store yet"; `null` means "read, and it was empty".
const cache: Cache = {
  accessToken: undefined,
  refreshToken: undefined,
  expiresAt: undefined,
  userId: undefined,
  email: undefined,
};

// A small notify-on-change subscription (not a poll, not a continuous watch) so the root
// layout's redirect logic can react to sign-in/sign-out without re-fetching from the
// keystore or subscribing to it — the RN equivalent of ADR-011's `refreshListenable`: it
// updates the redirect decision, it does not rebuild the navigator.
type SessionListener = () => void;
const listeners = new Set<SessionListener>();

export function subscribeToSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifySessionChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Synchronous, cache-only read for `useSyncExternalStore` — never touches the keystore. */
export function getCachedHasSession(): boolean {
  return cache.accessToken !== undefined && cache.accessToken !== null;
}

async function readCached(key: keyof Cache, storageKey: string): Promise<string | null> {
  if (cache[key] === undefined) {
    cache[key] = await SecureStore.getItemAsync(storageKey);
  }
  return cache[key] ?? null;
}

export async function getAccessToken(): Promise<string | null> {
  return readCached('accessToken', KEYS.accessToken);
}

export async function getRefreshToken(): Promise<string | null> {
  return readCached('refreshToken', KEYS.refreshToken);
}

export async function getExpiresAt(): Promise<string | null> {
  return readCached('expiresAt', KEYS.expiresAt);
}

export async function getUserId(): Promise<string | null> {
  return readCached('userId', KEYS.userId);
}

export async function getEmail(): Promise<string | null> {
  return readCached('email', KEYS.email);
}

/**
 * Read at redirect time by the root layout (ADR-011: not reactively watched). Presence of
 * an access token is treated as "signed in" — a stale/expired token is caught by the first
 * authenticated request's 401, not pre-emptively here (no clock-skew guessing games).
 */
export async function hasSession(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

export async function saveSession(
  session: SessionTokens,
  identity?: SessionIdentity,
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.accessToken, session.accessToken),
    SecureStore.setItemAsync(KEYS.refreshToken, session.refreshToken),
    SecureStore.setItemAsync(KEYS.expiresAt, session.expiresAt),
  ]);
  cache.accessToken = session.accessToken;
  cache.refreshToken = session.refreshToken;
  cache.expiresAt = session.expiresAt;

  if (identity?.userId !== undefined) {
    await SecureStore.setItemAsync(KEYS.userId, identity.userId);
    cache.userId = identity.userId;
  }
  if (identity?.email !== undefined) {
    await SecureStore.setItemAsync(KEYS.email, identity.email);
    cache.email = identity.email;
  }

  notifySessionChanged();
}

export async function clearSession(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((key) => SecureStore.deleteItemAsync(key)));
  cache.accessToken = null;
  cache.refreshToken = null;
  cache.expiresAt = null;
  cache.userId = null;
  cache.email = null;

  notifySessionChanged();
}
