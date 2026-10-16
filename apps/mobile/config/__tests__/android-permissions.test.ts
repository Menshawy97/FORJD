// FORJD never records audio and never reads the photo library: photos are picked through the system
// picker and share cards are only saved. Google Play's Photo and Video Permissions policy allows
// READ_MEDIA_IMAGES / READ_MEDIA_VIDEO only when the picker cannot do the job, so these must not reach
// the manifest. expo-image-picker (applied automatically by prebuild) and expo-media-library add them
// by default; `blockedPermissions` removes them however they arrive (docs/product/ios-settings-gaps.md).
import config from '../../app.config';

const UNUSED = [
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
];

type PluginEntry = string | [string, Record<string, unknown>];

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = (config.plugins as PluginEntry[] | undefined)?.find((plugin) =>
    Array.isArray(plugin) ? plugin[0] === name : plugin === name,
  );
  return Array.isArray(entry) ? entry[1] : undefined;
}

describe('Android permissions FORJD does not use', () => {
  it.each(UNUSED)('blocks %s', (permission) => {
    expect(config.android?.blockedPermissions).toContain(permission);
  });

  it('still blocks background location', () => {
    expect(config.android?.blockedPermissions).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
  });

  it('turns off the image picker microphone, which also drops the iPhone prompt', () => {
    expect(pluginOptions('expo-image-picker')).toMatchObject({ microphonePermission: false });
  });

  it('asks expo-media-library for no read permissions', () => {
    expect(pluginOptions('expo-media-library')).toMatchObject({ granularPermissions: [] });
  });
});
