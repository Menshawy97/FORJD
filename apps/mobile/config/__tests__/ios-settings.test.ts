/**
 * @jest-environment node
 */
// docs/product/ios-no-account-plan.md, slice 1, and ios-settings-gaps.md. The final iPhone settings,
// with every config plugin applied, must describe each real use (App Review 5.1.1(ii)), ask for nothing
// FORJD does not use, and let the background upload run. None of these may change the Android build,
// so the Android manifest is compared against the copy saved in __fixtures__.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { introspectConfig, type IntrospectedConfig } from '../../jest/introspect-config';

const ANDROID_MANIFEST_FIXTURE = join(__dirname, '../__fixtures__/android-manifest.json');

let config: IntrospectedConfig;
let infoPlist: Record<string, unknown>;

beforeAll(async () => {
  config = await introspectConfig();
  infoPlist = config._internal.modResults.ios.infoPlist;
}, 120_000);

describe('iPhone purpose strings', () => {
  it('names both camera uses: the InBody scan and the nutrition share card', () => {
    const text = String(infoPlist.NSCameraUsageDescription);
    expect(text).toMatch(/InBody/);
    expect(text).toMatch(/nutrition share card/);
  });

  it('names every photo library use: InBody scan, profile photo and share card background', () => {
    const text = String(infoPlist.NSPhotoLibraryUsageDescription);
    expect(text).toMatch(/InBody/);
    expect(text).toMatch(/profile photo/);
    expect(text).toMatch(/nutrition share card/);
  });

  it('asks for no Face ID, which FORJD never uses', () => {
    expect(infoPlist).not.toHaveProperty('NSFaceIDUsageDescription');
  });

  it('asks for no microphone, which FORJD never uses', () => {
    expect(infoPlist).not.toHaveProperty('NSMicrophoneUsageDescription');
  });

  it('claims no Always location', () => {
    expect(infoPlist).not.toHaveProperty('NSLocationAlwaysAndWhenInUseUsageDescription');
    expect(infoPlist).not.toHaveProperty('NSLocationAlwaysUsageDescription');
  });
});

describe('iPhone background upload (12C)', () => {
  it('has the processing background mode and the task identifier iOS requires', () => {
    expect(infoPlist.UIBackgroundModes).toEqual(expect.arrayContaining(['processing', 'location']));
    expect(infoPlist.BGTaskSchedulerPermittedIdentifiers).toContain('com.expo.modules.backgroundtask.processing');
  });
});

describe('iPhone export compliance', () => {
  it('declares only exempt encryption (HTTPS), so App Store Connect does not ask on every upload', () => {
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
    expect(infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });
});

describe('Android build', () => {
  it('keeps the same AndroidManifest as the saved copy', () => {
    const saved = JSON.parse(readFileSync(ANDROID_MANIFEST_FIXTURE, 'utf8'));
    expect(config._internal.modResults.android.manifest).toEqual(saved);
  });
});
