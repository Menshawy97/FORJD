import { Platform } from 'react-native';

type HealthConnectModule = typeof import('react-native-health-connect');

/**
 * Opens Health Connect's own settings, where the person can turn FORJD's access back on. Used by the
 * hint shown when a read was refused, which is the way the library's own docs say to send someone
 * to manage access (`health-connect.provider.ts` explains why FORJD never revokes it itself).
 *
 * Feature code calls this instead of importing the library (CLAUDE.md rule 17). Android only, and
 * guarded like `device-health-provider.ts`: without the native module (Expo Go) it returns `false`
 * rather than throwing. Returns whether Health Connect was asked to open.
 */
export function openDeviceHealthSettings(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    const { openHealthConnectSettings } = require('react-native-health-connect') as HealthConnectModule;
    openHealthConnectSettings();
    return true;
  } catch {
    return false;
  }
}
