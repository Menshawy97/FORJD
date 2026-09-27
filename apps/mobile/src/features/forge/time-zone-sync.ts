import AsyncStorage from '@react-native-async-storage/async-storage';

import { deviceTimeZone, putTimeZone } from '@/auth/apiClient';
import { TIME_ZONE_SENT_STORAGE_KEY } from '@/store/time-zone-sent';

export { TIME_ZONE_SENT_STORAGE_KEY };

/**
 * Tells the server the phone's time zone, which is where the athlete's Weekly Forge weeks close
 * (ADR-057 decision 3: each user's phone zone, Cairo until the phone has sent one).
 *
 * Called on launch and whenever the app returns to the foreground (`app/_layout.tsx`, beside
 * `syncPendingSessions`), but it only sends when the zone differs from the last one this sign-in
 * sent, so a normal day costs one storage read and no request. The endpoint is not behind the
 * Weekly Forge flag, so the zone is already right on the day the feature is switched on.
 *
 * The "last sent" copy belongs to a sign-in: `forgetAccountPreferences` clears it on every
 * sign-out, so the next account on the same phone sends its own zone. A copy is written only after
 * the server accepted the zone, so a failed send is retried next time. Never throws.
 */
export async function syncTimeZone(): Promise<void> {
  try {
    const zone = deviceTimeZone();
    if ((await readLastSent()) === zone) {
      return;
    }
    await putTimeZone(zone);
    await AsyncStorage.setItem(TIME_ZONE_SENT_STORAGE_KEY, zone);
  } catch {
    // Offline, signed out mid-request, or storage refused: the next launch tries again.
  }
}

async function readLastSent(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TIME_ZONE_SENT_STORAGE_KEY);
  } catch {
    return null;
  }
}
