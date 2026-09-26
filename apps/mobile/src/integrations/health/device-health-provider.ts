import type { HealthProvider } from '@forjd/domain';
import { Platform } from 'react-native';

type HealthConnectModule = typeof import('./health-connect.provider');

/**
 * The health provider for this phone, or `null` where there is none. Feature code asks for "the
 * device's health provider" and gets the `HealthProvider` interface, so it never names Health Connect
 * (CLAUDE.md rules 3 and 17; this folder is where `react-native-health-connect` may be imported).
 *
 * Android only: Apple Health is a separate decision for whichever ADR Phase 11 writes.
 *
 * The adapter is loaded here, lazily, rather than imported at the top (8.5 S10, L1-1): this file is
 * imported by cross-platform screens, and on Android without the native module (Expo Go) loading
 * the library throws. A guarded `require`, not `import()`, so it throws inside the `try` -- the same
 * pattern as the other adapters (`location-provider.ts`, `auth/google.ts`).
 */
export function getDeviceHealthProvider(): HealthProvider | null {
  if (Platform.OS !== 'android') return null;
  try {
    const { HealthConnectProvider } = require('./health-connect.provider') as HealthConnectModule;
    return new HealthConnectProvider();
  } catch {
    return null;
  }
}
