import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { getFeatureFlags } from '@/auth/apiClient';

/**
 * The server's feature flags (`GET /feature-flags`), so a dark feature such as Weekly Forge
 * (ADR-057) stays invisible in the app until its flag is switched on.
 *
 * - **Once per launch.** The first caller starts the request and every other caller shares it.
 *   A failed request is forgotten, so the next caller asks again rather than inheriting it.
 * - **Cached.** A successful answer is written under a `forjd.*` key, so a relaunch without a
 *   network still knows the last answer (and `clearLocalUserData` wipes it on account deletion).
 *   Flags are the same for every account, so the copy is kept across sign-outs.
 * - **Never throws.** A flag nobody can read is off: the feature simply stays hidden.
 */
export const FEATURE_FLAGS_STORAGE_KEY = 'forjd.featureFlags.v1';

let inFlight: Promise<readonly string[]> | null = null;

export function loadFeatureFlags(): Promise<readonly string[]> {
  if (!inFlight) {
    inFlight = fetchAndCache().catch(async () => {
      inFlight = null;
      return readCached();
    });
  }
  return inFlight;
}

/** Forgets the launch's answer. Tests only. */
export function resetFeatureFlagsForTests(): void {
  inFlight = null;
}

/** `false` until the flags are known, then whether `key` is switched on. */
export function useFeatureFlag(key: string): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void loadFeatureFlags().then((keys) => {
      if (active) {
        setEnabled(keys.includes(key));
      }
    });
    return () => {
      active = false;
    };
  }, [key]);

  return enabled;
}

async function fetchAndCache(): Promise<readonly string[]> {
  const { enabled } = await getFeatureFlags();
  try {
    await AsyncStorage.setItem(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(enabled));
  } catch {
    // The cache is a convenience for the next offline launch; this launch already has the answer.
  }
  return enabled;
}

async function readCached(): Promise<readonly string[]> {
  try {
    const raw = await AsyncStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}
