import type { HealthProvider } from '@forjd/domain';
import { Platform } from 'react-native';

import { HealthConnectProvider } from './health-connect.provider';

/**
 * The health provider for this phone, or `null` where there is none. Feature code asks for "the
 * device's health provider" and gets the `HealthProvider` interface, so it never names Health Connect
 * (CLAUDE.md rules 3 and 17; this folder is where `react-native-health-connect` may be imported).
 *
 * Android only: Apple Health is a separate decision for whichever ADR Phase 11 writes.
 */
export function getDeviceHealthProvider(): HealthProvider | null {
  return Platform.OS === 'android' ? new HealthConnectProvider() : null;
}
