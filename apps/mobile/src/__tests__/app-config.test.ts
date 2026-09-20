// Phase 10 / ADR-048. What the app declares to the operating system about location. Coarse and
// foreground only: the leaderboard needs a city, read once at the start of a workout, and
// nothing about it justifies a fine fix or tracking in the background. Store review checks this
// against what the app says it does.
import config from '../../app.config';

type PluginEntry = string | [string, Record<string, unknown>];

const locationPlugin = (): [string, Record<string, unknown>] | undefined =>
  (config.plugins as PluginEntry[]).find(
    (plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === 'expo-location',
  );

describe('app config: location', () => {
  it('registers the expo-location plugin with a purpose string that says what it is for', () => {
    const options = locationPlugin()?.[1];
    expect(options?.locationWhenInUsePermission).toEqual(expect.stringContaining('approximate location'));
    expect(options?.locationWhenInUsePermission).toEqual(expect.stringContaining('city leaderboard'));
    expect(options?.locationWhenInUsePermission).toEqual(expect.stringContaining('never stored'));
  });

  it('turns background location and the foreground service off', () => {
    const options = locationPlugin()?.[1];
    expect(options?.isAndroidBackgroundLocationEnabled).toBe(false);
    expect(options?.isAndroidForegroundServiceEnabled).toBe(false);
  });

  it('blocks the Android permissions a city does not need: fine and background location', () => {
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining(['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION']),
    );
  });

  it('does not block coarse location, which is the one permission it uses', () => {
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
