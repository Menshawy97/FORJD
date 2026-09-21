// ADR-041 / ADR-048. `expo-location` is a native module, and Expo Go does not always bundle every
// module the app is built with. The adapter must degrade, never crash, so a missing module
// cannot take a workout down with it. Each case uses its own registry so the lazy-load cache
// starts clean.

describe('location adapter without the native module', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-location');
  });

  const load = () => {
    jest.doMock('expo-location', () => {
      throw new Error("Cannot find native module 'ExpoLocation'");
    });
    return require('../location-provider') as typeof import('../location-provider');
  };

  it('reports permission as unavailable', async () => {
    await expect(load().getPermissionStatus()).resolves.toBe('unavailable');
  });

  it('reports a permission request as unavailable', async () => {
    await expect(load().requestCoarsePermission()).resolves.toBe('unavailable');
  });

  it('reports precise permission, and a precise watch, as unavailable', async () => {
    const adapter = load();
    await expect(adapter.getPrecisePermission()).resolves.toBe('unavailable');
    await expect(adapter.requestPrecisePermission()).resolves.toBe('unavailable');
    await expect(adapter.watchPrecisePosition(jest.fn())).resolves.toEqual({ status: 'unavailable' });
  });

  it('reads no position and does not throw', async () => {
    await expect(load().readCoarsePosition()).resolves.toBeNull();
  });

  it('does not load the module until something asks for it', () => {
    const factory = jest.fn(() => ({}));
    jest.doMock('expo-location', factory);
    require('../location-provider');
    expect(factory).not.toHaveBeenCalled();
  });

  it('loads the module once, however many calls follow', async () => {
    const factory = jest.fn(() => ({
      getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
    }));
    jest.doMock('expo-location', factory);
    const { getPermissionStatus } = require('../location-provider') as typeof import('../location-provider');

    await getPermissionStatus();
    await getPermissionStatus();
    await getPermissionStatus();

    expect(factory).toHaveBeenCalledTimes(1);
  });
});
