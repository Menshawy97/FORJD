import type { HealthProvider } from '@forjd/domain';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

type HealthConnectModule = typeof import('./health-connect.provider');
type AppleHealthModule = typeof import('./apple-health.provider');

/**
 * The health provider for this phone, or `null` where there is none. Feature code asks for "the
 * device's health provider" and gets the `HealthProvider` interface, so it never names Health Connect
 * or HealthKit (CLAUDE.md rules 3 and 17; this folder is where `react-native-health-connect` and
 * `@kingstinct/react-native-healthkit` may be imported).
 *
 * Android: Health Connect. iPhone: Apple Health (ADR-068), **only when the build switches it on**
 * (`extra.appleHealthEnabled`, ADR-069); until it has run on a physical iPhone no build does, and
 * iPhone has no provider, as before.
 *
 * Each adapter is loaded here, lazily, rather than imported at the top (8.5 S10, L1-1): this file is
 * imported by cross-platform screens, and without the native module (Expo Go) loading a library
 * throws. A guarded `require`, not `import()`, so it throws inside the `try` -- the same pattern as
 * the other adapters (`location-provider.ts`, `auth/google.ts`).
 */
export function getDeviceHealthProvider(): HealthProvider | null {
  if (Platform.OS === 'android') return loadHealthConnect();
  if (Platform.OS === 'ios' && Constants.expoConfig?.extra?.appleHealthEnabled === true) return loadAppleHealth();
  return null;
}

function loadHealthConnect(): HealthProvider | null {
  try {
    const { HealthConnectProvider } = require('./health-connect.provider') as HealthConnectModule;
    return new HealthConnectProvider();
  } catch {
    return null;
  }
}

function loadAppleHealth(): HealthProvider | null {
  try {
    const { AppleHealthProvider } = require('./apple-health.provider') as AppleHealthModule;
    return new AppleHealthProvider();
  } catch {
    return null;
  }
}
