// The final native settings, as `npx expo config --type introspect` prints them: app.config.ts with
// every config plugin applied (the listed ones and those Expo applies on its own), without writing an
// ios/ or android/ folder. Used by the config tests to check the real Info.plist and AndroidManifest,
// not only the options app.config.ts passes (docs/product/ios-no-account-plan.md).
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

type ModResults = {
  ios: { infoPlist: Record<string, unknown>; entitlements: Record<string, unknown> };
  android: { manifest: unknown };
};

export type IntrospectedConfig = {
  ios?: { config?: Record<string, unknown> };
  plugins?: (string | [string, unknown])[];
  extra?: Record<string, unknown>;
  runtimeVersion?: unknown;
  updates?: Record<string, unknown>;
  _internal: { modResults: ModResults };
};

// app.config.ts reads these; set in a developer's shell they would add a Maps key, a Firebase file or
// a URL scheme, or trip the production guard. Left out of the child's environment so the result is
// the same everywhere, as on CI.
const BUILD_ENV = new Set([
  'EAS_BUILD_PROFILE',
  'FORJD_UPDATE_PROFILE',
  'API_BASE_URL',
  'GOOGLE_MAPS_ANDROID_API_KEY',
  'GOOGLE_SERVICES_JSON',
  'GOOGLE_IOS_URL_SCHEME',
  'APPLE_SIGN_IN_ENABLED',
  'APPLE_HEALTH_ENABLED',
]);

const SCRIPT = join(__dirname, 'introspect-config-cli.js');
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** `buildEnv` sets build variables for this run only (e.g. `{ APPLE_HEALTH_ENABLED: 'true' }`). */
export async function introspectConfig(buildEnv: Record<string, string> = {}): Promise<IntrospectedConfig> {
  const env = { ...process.env };
  BUILD_ENV.forEach((name) => delete env[name]);
  Object.assign(env, buildEnv);
  const { stdout } = await promisify(execFile)(process.execPath, [SCRIPT], { env, maxBuffer: MAX_OUTPUT_BYTES });
  return JSON.parse(stdout) as IntrospectedConfig;
}
