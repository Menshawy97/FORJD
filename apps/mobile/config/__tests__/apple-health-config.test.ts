/**
 * @jest-environment node
 */
// ADR-069 and ADR-068. Apple Health merges switched off, behind APPLE_HEALTH_ENABLED. Off, the iPhone
// build must declare no HealthKit at all (Apple can reject declared-but-unused HealthKit). On, it is
// read only: the share (read) text, no update (write) text, no background delivery. Either way the
// Android build must not change: the library's peer, react-native-nitro-modules, has Android native
// code, so it is kept out of Android autolinking.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { introspectConfig, type IntrospectedConfig } from '../../jest/introspect-config';

const PROJECT_ROOT = join(__dirname, '../..');
const HEALTHKIT_PACKAGES = ['@kingstinct/react-native-healthkit', 'react-native-nitro-modules'];
const HEALTHKIT_ENTITLEMENT = 'com.apple.developer.healthkit';
const ANDROID_MANIFEST_FIXTURE = join(__dirname, '../__fixtures__/android-manifest.json');

/** What React Native autolinking links for one platform, as the native build would see it. */
async function autolinkedFor(platform: 'android' | 'ios'): Promise<string[]> {
  const expoPackage = require.resolve('expo/package.json', { paths: [PROJECT_ROOT] });
  const bin = require.resolve('expo-modules-autolinking/bin/expo-modules-autolinking.js', { paths: [expoPackage] });
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [bin, 'react-native-config', '--platform', platform, '--json'],
    { cwd: PROJECT_ROOT, maxBuffer: 32 * 1024 * 1024 },
  );
  return Object.keys((JSON.parse(stdout) as { dependencies: Record<string, unknown> }).dependencies);
}

let off: IntrospectedConfig;
let on: IntrospectedConfig;

beforeAll(async () => {
  [off, on] = await Promise.all([introspectConfig(), introspectConfig({ APPLE_HEALTH_ENABLED: 'true' })]);
}, 180_000);

describe('Apple Health switched off (the default, every eas.json profile)', () => {
  it('declares no HealthKit entitlement and no health purpose strings on iPhone', () => {
    expect(off._internal.modResults.ios.entitlements).not.toHaveProperty([HEALTHKIT_ENTITLEMENT]);
    expect(off._internal.modResults.ios.infoPlist).not.toHaveProperty('NSHealthShareUsageDescription');
    expect(off._internal.modResults.ios.infoPlist).not.toHaveProperty('NSHealthUpdateUsageDescription');
  });

  it('tells the app it is off', () => {
    expect(off.extra?.appleHealthEnabled).toBe(false);
  });

  it('is not turned on by any eas.json profile', () => {
    const eas = JSON.parse(readFileSync(join(PROJECT_ROOT, 'eas.json'), 'utf8')) as {
      build: Record<string, { env?: Record<string, string> }>;
    };
    for (const profile of Object.values(eas.build)) {
      expect(profile.env?.APPLE_HEALTH_ENABLED).toBeUndefined();
    }
  });
});

describe('Apple Health switched on (only after the iPhone walk, ADR-069)', () => {
  it('adds the HealthKit entitlement without background delivery', () => {
    const entitlements = on._internal.modResults.ios.entitlements;
    expect(entitlements[HEALTHKIT_ENTITLEMENT]).toBe(true);
    expect(entitlements).not.toHaveProperty(['com.apple.developer.healthkit.background-delivery']);
  });

  it('asks to read only, with a purpose string that says what is read and why', () => {
    const plist = on._internal.modResults.ios.infoPlist;
    const text = String(plist.NSHealthShareUsageDescription);
    expect(text).toMatch(/^FORJD /);
    expect(text).toMatch(/heart rate/);
    expect(text).toMatch(/run/);
    expect(text).toMatch(/never writes/);
    expect(plist).not.toHaveProperty('NSHealthUpdateUsageDescription');
  });

  it('tells the app it is on', () => {
    expect(on.extra?.appleHealthEnabled).toBe(true);
  });

  it('leaves the Android manifest exactly as saved', () => {
    const saved = JSON.parse(readFileSync(ANDROID_MANIFEST_FIXTURE, 'utf8'));
    expect(on._internal.modResults.android.manifest).toEqual(saved);
  });
});

describe('native linking', () => {
  it('links neither HealthKit nor its Nitro peer into the Android app', async () => {
    const android = await autolinkedFor('android');
    for (const name of HEALTHKIT_PACKAGES) {
      expect(android).not.toContain(name);
    }
  }, 120_000);

  it('links both into the iPhone app, so the simulator build compiles them', async () => {
    const ios = await autolinkedFor('ios');
    for (const name of HEALTHKIT_PACKAGES) {
      expect(ios).toContain(name);
    }
  }, 120_000);
});
