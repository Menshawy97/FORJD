/**
 * @jest-environment node
 */
// docs/product/ios-no-account-plan.md, slice 2. The first EAS iOS simulator build failed in prebuild:
// a workspace override forced @xmldom/xmldom 0.9, whose parseFromString needs a mime type that
// @expo/plist (written for 0.8) never passes, so no Info.plist could be read. Android never reads a
// plist, so nothing else caught it. This parses one through the same @expo/plist prebuild uses.
import { join } from 'node:path';

const PROJECT_ROOT = join(__dirname, '../..');
const fromExpo = { paths: [require.resolve('expo/package.json', { paths: [PROJECT_ROOT] })] };
const fromCli = { paths: [require.resolve('@expo/cli/package.json', fromExpo)] };
const fromConfigPlugins = { paths: [require.resolve('@expo/config-plugins/package.json', fromCli)] };
const plistPath = require.resolve('@expo/plist', fromConfigPlugins);

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>FORJD</string>
  <key>UIBackgroundModes</key>
  <array><string>processing</string></array>
</dict>
</plist>`;

describe('iPhone prebuild can read an Info.plist', () => {
  it('parses a plist with the @expo/plist prebuild uses', () => {
    const plist = require(plistPath).default;
    expect(plist.parse(INFO_PLIST)).toEqual({ CFBundleName: 'FORJD', UIBackgroundModes: ['processing'] });
  });

  it('gets an @xmldom/xmldom from the patched 0.8 line (0.8.15 or later, not 0.9)', () => {
    const xmldom = require(require.resolve('@xmldom/xmldom/package.json', { paths: [plistPath] }));
    const [major, minor, patch] = String(xmldom.version).split('.').map(Number);
    expect([major, minor]).toEqual([0, 8]);
    expect(patch).toBeGreaterThanOrEqual(15);
  });
});
