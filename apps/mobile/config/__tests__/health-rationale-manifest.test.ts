// docs/product/health-connect-privacy-link-plan.md. Health Connect's "privacy policy" link must open the
// same policy given to Play Console (Google's Health Connect guide). A small native activity in
// modules/forjd-health-rationale does that; Jest cannot run its Kotlin, so these tests pin the files
// the Android build reads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRIVACY_POLICY_URL } from '../../src/legal/links';

const MODULE_DIR = join(__dirname, '../../modules/forjd-health-rationale/android/src/main');
const ACTIVITY_NAME = 'expo.modules.forjdhealthrationale.HealthPermissionsRationaleActivity';

const manifest = readFileSync(join(MODULE_DIR, 'AndroidManifest.xml'), 'utf8');
const kotlin = readFileSync(
  join(MODULE_DIR, 'java/expo/modules/forjdhealthrationale/HealthPermissionsRationaleActivity.kt'),
  'utf8',
);
const appConfig = readFileSync(join(__dirname, '../../app.config.ts'), 'utf8');

/** Every `<tag ...>...</tag>` block in the manifest, comments removed. */
function blocks(tag: string): string[] {
  const xml = manifest.replace(/<!--[\s\S]*?-->/g, '');
  return xml.match(new RegExp(`<${tag}\\s[\\s\\S]*?</${tag}>`, 'g')) ?? [];
}

function attr(block: string, name: string): string | undefined {
  return block.match(new RegExp(`android:${name}="([^"]*)"`))?.[1];
}

describe('Health Connect privacy link', () => {
  it('declares one exported activity that receives the Android 13 rationale intent', () => {
    const activities = blocks('activity');
    expect(activities).toHaveLength(1);
    const activity = activities[0] ?? '';
    expect(attr(activity, 'name')).toBe(ACTIVITY_NAME);
    expect(attr(activity, 'exported')).toBe('true');
    expect(activity).toContain('android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"');
  });

  it('declares the Android 14 alias, guarded and pointing at that activity', () => {
    const aliases = blocks('activity-alias');
    expect(aliases).toHaveLength(1);
    const alias = aliases[0] ?? '';
    expect(attr(alias, 'exported')).toBe('true');
    expect(attr(alias, 'targetActivity')).toBe(ACTIVITY_NAME);
    expect(attr(alias, 'permission')).toBe('android.permission.START_VIEW_PERMISSION_USAGE');
    expect(alias).toContain('android:name="android.intent.action.VIEW_PERMISSION_USAGE"');
    expect(alias).toContain('android:name="android.intent.category.HEALTH_PERMISSIONS"');
  });

  it('opens exactly the privacy policy the app links to everywhere else', () => {
    const urls = kotlin.match(/"https:\/\/[^"]+"/g) ?? [];
    expect(urls).toEqual([`"${PRIVACY_POLICY_URL}"`]);
  });

  it("no longer uses the library's plugin, which points both entries at MainActivity", () => {
    expect(appConfig).not.toMatch(/['"]react-native-health-connect['"]/);
  });
});
