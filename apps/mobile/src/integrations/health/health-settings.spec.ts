// Opens Health Connect's own settings, where the person turned access off and can turn it back on.
// The library may only be imported inside this folder (CLAUDE.md rule 17).
import { Platform } from 'react-native';

const mockOpenSettings = jest.fn();
jest.mock('react-native-health-connect', () => ({
  openHealthConnectSettings: (...args: unknown[]) => mockOpenSettings(...args),
}));

import { openDeviceHealthSettings } from './health-settings';

const setPlatform = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

afterEach(() => {
  mockOpenSettings.mockReset();
  setPlatform('android');
});

describe('openDeviceHealthSettings', () => {
  it('opens Health Connect settings on Android and says it did', () => {
    setPlatform('android');

    expect(openDeviceHealthSettings()).toBe(true);
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('does nothing and says so on a phone with no Health Connect', () => {
    setPlatform('ios');

    expect(openDeviceHealthSettings()).toBe(false);
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });

  it('never throws when the native module fails', () => {
    setPlatform('android');
    mockOpenSettings.mockImplementation(() => {
      throw new Error('no activity');
    });

    expect(openDeviceHealthSettings()).toBe(false);
  });
});
