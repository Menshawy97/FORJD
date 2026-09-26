/**
 * 8.5 S10, L1-1: `device-health-provider.ts` used to import the Health Connect adapter (and so
 * `react-native-health-connect`) at the top of the file. Cross-platform screens import this
 * file, so the Android-only library was evaluated everywhere; on Android without the native
 * module (Expo Go) that import throws and takes the screen with it. It now loads the adapter
 * only on Android, only when asked, and degrades to "no provider" if loading fails -- the
 * lazy `require` in `try/catch` that every sibling adapter already uses (google.ts, apple.ts,
 * location-provider.ts, route-map.tsx).
 *
 *
 * A fresh module registry per test (`beforeEach` below), not `isolateModules`: the adapter is
 * required lazily, after the loader returns, so it must resolve against this test's mocks.
 */
function loadWithPlatform(os: 'ios' | 'android', adapterFactory: () => unknown) {
  const factory = jest.fn(adapterFactory);
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  jest.doMock('./health-connect.provider', () => factory());
  const { getDeviceHealthProvider } = require('./device-health-provider') as typeof import('./device-health-provider');
  return { getDeviceHealthProvider, factory };
}

class StubHealthConnectProvider {
  readonly source = 'health_connect';
}

describe('getDeviceHealthProvider', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock('react-native');
    jest.dontMock('./health-connect.provider');
  });

  it('does not load the Health Connect library at import time', () => {
    const { factory } = loadWithPlatform('android', () => ({ HealthConnectProvider: StubHealthConnectProvider }));

    expect(factory).not.toHaveBeenCalled();
  });

  it('never loads it on iOS, and has no provider there', () => {
    const { getDeviceHealthProvider, factory } = loadWithPlatform('ios', () => ({
      HealthConnectProvider: StubHealthConnectProvider,
    }));

    expect(getDeviceHealthProvider()).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns the Health Connect provider on Android', () => {
    const { getDeviceHealthProvider } = loadWithPlatform('android', () => ({
      HealthConnectProvider: StubHealthConnectProvider,
    }));

    expect(getDeviceHealthProvider()).toBeInstanceOf(StubHealthConnectProvider);
  });

  it('has no provider, rather than crashing, when the native module cannot load (Expo Go)', () => {
    const { getDeviceHealthProvider } = loadWithPlatform('android', () => {
      throw new Error("TurboModuleRegistry.getEnforcing(...): 'HealthConnect' could not be found");
    });

    expect(() => getDeviceHealthProvider()).not.toThrow();
    expect(getDeviceHealthProvider()).toBeNull();
  });
});
