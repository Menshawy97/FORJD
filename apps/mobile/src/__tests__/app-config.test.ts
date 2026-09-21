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

  it('turns background location and the foreground service off', () => {
    const options = locationPlugin()?.[1];
    expect(options?.isAndroidBackgroundLocationEnabled).toBe(false);
    expect(options?.isAndroidForegroundServiceEnabled).toBe(false);
  });

  it('still blocks background location on Android', () => {
    expect(config.android?.blockedPermissions).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
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
