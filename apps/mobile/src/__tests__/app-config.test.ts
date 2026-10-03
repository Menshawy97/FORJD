// Phase 10 / ADR-048, amended by ADR-049. What the app declares to the operating system about
// location. Foreground only. The leaderboard needs a coarse city, read once at the start of a
// workout; the run screen needs a precise position while a run is open. Nothing justifies
// tracking in the background. Store review checks this against what the app says it does.
import config from '../../app.config';

type PluginEntry = string | [string, Record<string, unknown>];

const locationPlugin = (): [string, Record<string, unknown>] | undefined =>
  (config.plugins as PluginEntry[]).find(
    (plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === 'expo-location',
  );

describe('app config: notifications (12A-3)', () => {
  it('draws notifications with the FORJD symbol in ember, as the approved replica shows', () => {
    const entry = (config.plugins as PluginEntry[]).find(
      (plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
    );

    expect(entry?.[1]).toEqual({ icon: './assets/images/android-icon-monochrome.png', color: '#E9712F' });
  });
});

describe('app config: location', () => {
  it('registers the expo-location plugin with a purpose string that says what it is for', () => {
    const options = locationPlugin()?.[1];
    expect(options?.locationWhenInUsePermission).toEqual(expect.stringContaining('approximate location'));
    expect(options?.locationWhenInUsePermission).toEqual(expect.stringContaining('city leaderboard'));
  });

  it('says the run screen uses a precise position while a run is open, and keeps the route on the phone', () => {
    const text = String(locationPlugin()?.[1].locationWhenInUsePermission);
    expect(text).toContain('precise location while a run is open');
    expect(text).toContain('stays on your phone');
    expect(text).toContain('never uploaded');
  });

  it('runs a location foreground service for runs, but never background location (ADR-059)', () => {
    const options = locationPlugin()?.[1];
    expect(options?.isAndroidBackgroundLocationEnabled).toBe(false);
    expect(options?.isAndroidForegroundServiceEnabled).toBe(true);
    expect(options?.isIosBackgroundLocationEnabled).toBe(true);
    expect(options?.androidForegroundServiceIcon).toBe('./assets/images/android-icon-monochrome.png');
  });

  it('still blocks background location on Android', () => {
    expect(config.android?.blockedPermissions).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
  });

  // R8: a run reads a watch's heart rate and active energy from Health Connect, read-only. Only
  // those two are declared: every extra health permission is a store-review question.
  it('declares read access to heart rate and active energy in Health Connect, and no more', () => {
    const permissions = config.android?.permissions ?? [];
    expect(permissions).toContain('android.permission.health.READ_HEART_RATE');
    expect(permissions).toContain('android.permission.health.READ_ACTIVE_CALORIES_BURNED');
    expect(permissions.filter((p) => p.startsWith('android.permission.health.'))).toHaveLength(2);
    expect(permissions.some((p) => p.startsWith('android.permission.health.WRITE'))).toBe(false);
  });

  it('no longer blocks fine location, which a run needs (ADR-049), nor coarse, which the leaderboard uses', () => {
    expect(config.android?.blockedPermissions).not.toContain('android.permission.ACCESS_FINE_LOCATION');
    expect(config.android?.blockedPermissions).not.toContain('android.permission.ACCESS_COARSE_LOCATION');
  });

  // The plugin writes the "Always" and motion purpose strings by default even with background
  // location off, and a build config is the only layer visible from here: an option of `false`
  // makes @expo/config-plugins delete the key. Left in, App Review sees an app that says it may
  // use location in the background, which is the opposite of what this one does.
  it.each(['locationAlwaysAndWhenInUsePermission', 'locationAlwaysPermission', 'motionUsagePermission'])(
    'switches off the iOS %s the plugin would otherwise add',
    (option) => {
      expect(locationPlugin()?.[1]).toHaveProperty(option, false);
    },
  );

  it('does not set an always-on location purpose string in the iOS Info.plist itself', () => {
    const plist = config.ios?.infoPlist ?? {};
    expect(plist).not.toHaveProperty('NSLocationAlwaysAndWhenInUseUsageDescription');
    expect(plist).not.toHaveProperty('NSLocationAlwaysUsageDescription');
  });
});

// ADR-050. The run map's Google Maps key is a client key, restricted to the app in the Google Cloud
// console and supplied as an EAS environment variable, never committed. Without it the app still
// builds and the route map falls back to the striped background, so the plugin is only added when
// a key exists, and the key itself never reaches `extra` (only whether one exists).
describe('app config: the run map key', () => {
  const loadConfig = (key: string | undefined) => {
    const previous = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
    if (key === undefined) delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;
    else process.env.GOOGLE_MAPS_ANDROID_API_KEY = key;
    try {
      let loaded: typeof config | undefined;
      jest.isolateModules(() => {
        loaded = require('../../app.config').default;
      });
      return loaded as typeof config;
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;
      else process.env.GOOGLE_MAPS_ANDROID_API_KEY = previous;
    }
  };

  const mapsPlugin = (c: typeof config) =>
    (c.plugins as PluginEntry[]).find((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'react-native-maps');

  it('adds no maps plugin, and reports no key, when none is configured', () => {
    const c = loadConfig(undefined);
    expect(mapsPlugin(c)).toBeUndefined();
    expect(c.extra?.hasMapsKey).toBe(false);
  });

  it('treats an empty key as no key', () => {
    const c = loadConfig('');
    expect(mapsPlugin(c)).toBeUndefined();
    expect(c.extra?.hasMapsKey).toBe(false);
  });

  it('registers the maps plugin with the Android key when one is configured', () => {
    const c = loadConfig('test-android-key');
    expect(mapsPlugin(c)).toEqual(['react-native-maps', { androidGoogleMapsApiKey: 'test-android-key' }]);
    expect(c.extra?.hasMapsKey).toBe(true);
  });

  it('never puts the key itself into extra, which ships as readable JSON in the bundle', () => {
    const c = loadConfig('test-android-key');
    expect(JSON.stringify(c.extra)).not.toContain('test-android-key');
  });

  it('gives the plugin no iOS key: iOS has no Google Maps setup until Phase 11 decides one', () => {
    const plugin = mapsPlugin(loadConfig('test-android-key')) as [string, Record<string, unknown>];
    expect(plugin[1]).not.toHaveProperty('iosGoogleMapsApiKey');
  });
});
