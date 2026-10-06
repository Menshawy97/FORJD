import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { RegisterPushTokenRequest, RemovePushTokenRequest } from '@forjd/contracts';

import { registerPushToken, removePushToken } from '@/auth/apiClient';
import { getUserId } from '@/auth/secureStorage';
import { loadNotificationPreferences } from '@/store/notification-preferences';
import { clearPushToken, loadPushToken, savePushToken, type StoredPushToken } from '@/store/push-token';

/**
 * The phone's side of server push (Phase 12F, ADR-060, docs/product/phase-12f-plan.md): once the phone allows
 * notifications and the person wants a push (PR celebrations or leaderboard moves), ask the push service for this
 * install's token and tell the server; take it off the server when both are off and before sign-out. Everything native
 * or networked is injected (the ADR-026 seam), so the logic is tested without a phone. **Nothing here throws, and none
 * of it is in the path of a workout** (CLAUDE.md rule 6): a phone without push set up (no Firebase config yet, no network)
 * simply does not register and the app works as it does today. No token is ever logged.
 */
export const PUSH_CHANNEL_ID = 'updates';
const SERVER_PLATFORMS: readonly string[] = ['android', 'ios'];
/** A token the server took less than a week ago is not sent again; after that it is, so its "last seen" stays current. */
const REFRESH_AFTER_MS = 7 * 86_400_000;
/** A sign-out waits this long for the server to forget the token, then goes ahead without it. */
const UNREGISTER_TIMEOUT_MS = 3000;

export interface PushApi {
  platform: string;
  /** The EAS project id the token is issued for, or `null` outside an EAS-configured build. */
  projectId: string | null;
  getPermissionGranted: () => Promise<boolean>;
  /** The Android channel the server's pushes arrive on; Android 13 and later need it before the token or the prompt. */
  setChannel: () => Promise<void>;
  getExpoPushToken: (projectId: string) => Promise<string>;
}

export interface PushRegistrationDeps {
  api: PushApi;
  tokenStore: {
    load: () => Promise<StoredPushToken | null>;
    save: (value: StoredPushToken) => Promise<void>;
    clear: () => Promise<void>;
  };
  register: (body: RegisterPushTokenRequest) => Promise<void>;
  remove: (body: RemovePushTokenRequest) => Promise<void>;
  loadSwitches: () => Promise<{ pr: boolean; rank: boolean }>;
  /** The signed-in account, or `null` when no one is. */
  getUserId: () => Promise<string | null>;
  now?: () => number;
}

export type RegisterOutcome = 'registered' | 'fresh' | 'no_permission' | 'unavailable' | 'failed';
export type SyncOutcome = RegisterOutcome | 'removed' | 'none';

const readProjectId = (): string | null => {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: unknown } }).easConfig?.projectId;
  const id = typeof fromConfig === 'string' ? fromConfig : fromEas;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export const defaultPushApi: PushApi = {
  platform: Platform.OS,
  projectId: readProjectId(),
  getPermissionGranted: async () => (await Notifications.getPermissionsAsync()).granted,
  setChannel: async () => {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: 'Updates',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },
  getExpoPushToken: async (projectId) => (await Notifications.getExpoPushTokenAsync({ projectId })).data,
};

export const defaultPushDeps: PushRegistrationDeps = {
  api: defaultPushApi,
  tokenStore: { load: loadPushToken, save: savePushToken, clear: clearPushToken },
  register: registerPushToken,
  remove: removePushToken,
  loadSwitches: async () => {
    const { pr, rank } = await loadNotificationPreferences();
    return { pr, rank };
  },
  getUserId,
};

/** Bumped by every sign-out removal, so a registration that was on its way then does not keep its token. */
let removalGeneration = 0;
/** The registration in flight, so syncs that start together send one request. */
let inFlight: { deps: PushRegistrationDeps; promise: Promise<RegisterOutcome> } | null = null;

/** Asks for this install's token and tells the server, when the phone allows it. Never throws. */
export function registerForPush(deps: PushRegistrationDeps = defaultPushDeps): Promise<RegisterOutcome> {
  if (inFlight?.deps === deps) return inFlight.promise;
  const promise = registerOnce(deps).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { deps, promise };
  return promise;
}

async function registerOnce(deps: PushRegistrationDeps): Promise<RegisterOutcome> {
  const generation = removalGeneration;
  try {
    const { api } = deps;
    if (!SERVER_PLATFORMS.includes(api.platform) || api.projectId === null) return 'unavailable';
    if (!(await api.getPermissionGranted())) return 'no_permission';

    let token: string;
    try {
      if (api.platform === 'android') await api.setChannel();
      token = await api.getExpoPushToken(api.projectId);
    } catch {
      return 'unavailable';
    }

    const userId = await deps.getUserId();
    if (userId === null) return 'unavailable';
    const now = (deps.now ?? Date.now)();
    const stored = await deps.tokenStore.load();
    if (stored && stored.token === token && stored.userId === userId && now - stored.registeredAt < REFRESH_AFTER_MS) {
      return 'fresh';
    }

    try {
      await deps.register({ token, platform: api.platform as RegisterPushTokenRequest['platform'] });
    } catch {
      return 'failed';
    }
    if (generation !== removalGeneration) {
      // Signed out while the request was on its way: the server may have taken the token after the removal, so take it off again.
      await deps.remove({ token }).catch(() => undefined);
      return 'failed';
    }
    await deps.tokenStore.save({ token, registeredAt: now, userId });
    return 'registered';
  } catch {
    return 'unavailable';
  }
}

/**
 * Takes this install's token off the server and forgets it, giving the server a few seconds at most so a sign-out is never
 * held up. The token is forgotten here even when the server could not be reached. Answers whether the server took it off.
 */
export async function unregisterFromPush(
  deps: PushRegistrationDeps = defaultPushDeps,
  timeoutMs: number = UNREGISTER_TIMEOUT_MS,
): Promise<boolean> {
  removalGeneration += 1;
  let removed = false;
  try {
    const stored = await deps.tokenStore.load();
    if (!stored) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
      const result = await Promise.race([deps.remove({ token: stored.token }).then(() => 'done' as const), timeout]);
      removed = result === 'done';
    } finally {
      clearTimeout(timer);
    }
  } catch {
    removed = false;
  }
  try {
    await deps.tokenStore.clear();
  } catch {
    // Best effort.
  }
  return removed;
}

/**
 * Brings the registration in line with what the person wants: registers when either push is on and the phone allows
 * notifications, and takes the token off the server when both are off. Never throws.
 */
export async function syncPushRegistration(deps: PushRegistrationDeps = defaultPushDeps): Promise<SyncOutcome> {
  try {
    const { pr, rank } = await deps.loadSwitches();
    if (pr || rank) return await registerForPush(deps);
    return (await unregisterFromPush(deps)) ? 'removed' : 'none';
  } catch {
    return 'none';
  }
}
