// @ts-check
/* global require, module, process, __dirname -- run by Node: `pnpm update:staging -m "..."`. */
/**
 * Publishes an over-the-air update (ADR-071). Use this, never a bare `eas update`.
 *
 * `eas update` reads neither the build profile's `env` in eas.json nor `EAS_BUILD_PROFILE`, so a bare run
 * would bundle `extra.apiBaseUrl` as this computer's localhost default and skip the address check in
 * app.config.ts: every phone on the channel would lose the server. This script:
 * 1. takes API_BASE_URL and GOOGLE_WEB_CLIENT_ID from the channel's own build profile in eas.json, and
 *    runs the same address check a production build runs (config/api-base-url.js);
 * 2. refuses a production update from a working tree with uncommitted changes;
 * 3. works out the update's runtime version per platform, with the same EAS environment variables a
 *    build gets, and publishes only to the platforms that have a finished build on the channel with that
 *    runtime version. None → it stops: the native layer changed, so this needs a store build.
 */
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { checkApiBaseUrl } = require('../config/api-base-url');

/** Each update channel, the build profile that sets it, and the EAS environment that profile builds with. */
const CHANNELS = {
  staging: { profile: 'staging', environment: 'preview' },
  production: { profile: 'production', environment: 'production' },
};

/** @typedef {'android' | 'ios'} Platform */
const PLATFORMS = /** @type {const} */ (['android', 'ios']);

/**
 * Decides whether an update may be published, and with which settings. Pure, so it is unit tested.
 * @param {{ channel: string | undefined, message: string | undefined, easJson: { build?: Record<string, { channel?: string, env?: Record<string, string> }> }, dirty: boolean }} input
 * @returns {{ error: string } | { profile: string, environment: string, env: Record<string, string> }}
 */
function planUpdate({ channel, message, easJson, dirty }) {
  const target = channel && Object.prototype.hasOwnProperty.call(CHANNELS, channel)
    ? CHANNELS[/** @type {keyof typeof CHANNELS} */ (channel)]
    : undefined;
  if (!channel || !target) return { error: `Unknown channel "${channel ?? ''}". Use one of: ${Object.keys(CHANNELS).join(', ')}` };
  if (!message || !message.trim()) return { error: 'Say what the update changes: -m "..."' };

  const profile = easJson.build?.[target.profile];
  if (!profile) return { error: `eas.json has no "${target.profile}" build profile` };
  if (profile.channel !== channel) {
    return { error: `eas.json's "${target.profile}" profile builds for channel "${profile.channel ?? ''}", not "${channel}"` };
  }

  const env = profile.env ?? {};
  const addressProblem = checkApiBaseUrl(target.profile, env.API_BASE_URL);
  if (addressProblem) return { error: `Update refused: ${addressProblem}` };
  if (!env.API_BASE_URL) return { error: `Update refused: eas.json's "${target.profile}" profile sets no API_BASE_URL` };
  if (channel === 'production' && dirty) {
    return { error: 'Update refused: commit or stash your changes first. A production update ships exactly what is in the working tree.' };
  }

  return {
    profile: target.profile,
    environment: target.environment,
    // FORJD_UPDATE_PROFILE lets app.config.ts run the same address check while eas update reads it.
    env: { ...env, FORJD_UPDATE_PROFILE: target.profile },
  };
}

/**
 * The `--platform` value for `eas update`, given which platforms have a build that can take the update.
 * @param {Record<Platform, boolean>} compatible
 * @returns {'all' | Platform | null}
 */
function platformsToPublish(compatible) {
  if (compatible.android && compatible.ios) return 'all';
  if (compatible.android) return 'android';
  if (compatible.ios) return 'ios';
  return null;
}

/**
 * @param {string} command
 * @param {Record<string, string>} env
 * @param {{ capture?: boolean }} [options]
 */
function run(command, env, options = {}) {
  const result = spawnSync(command, {
    cwd: join(__dirname, '..'),
    env: { ...process.env, ...env },
    shell: true,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Failed (exit ${result.status}): ${command}`);
  return result.stdout ?? '';
}

/**
 * The runtime version `eas update` will give this platform: the fingerprint, computed with the same
 * EAS environment variables a build of this profile gets (they decide which config plugins apply).
 * @param {Platform} platform
 * @param {string} environment
 * @param {Record<string, string>} env
 */
function runtimeVersionFor(platform, environment, env) {
  // Non-interactive env:exec passes the command's stdout through untouched; its own notices go to stderr.
  const json = run(
    `npx eas env:exec ${environment} "npx expo-updates fingerprint:generate --platform ${platform}" --non-interactive`,
    env,
    { capture: true },
  );
  return /** @type {{ hash: string }} */ (JSON.parse(json)).hash;
}

/**
 * Whether a finished build on the channel has this runtime version, so it can take the update.
 * @param {string} channel
 * @param {Platform} platform
 * @param {string} runtimeVersion
 */
function hasCompatibleBuild(channel, platform, runtimeVersion) {
  const json = run(
    `npx eas build:list --channel ${channel} --platform ${platform} --status finished --runtime-version ${runtimeVersion} --limit 1 --json --non-interactive`,
    {},
    { capture: true },
  );
  return /** @type {unknown[]} */ (JSON.parse(json)).length > 0;
}

function main() {
  const args = process.argv.slice(2);
  const channel = args[0];
  const flag = args.findIndex((a) => a === '-m' || a === '--message');
  const message = flag >= 0 ? args[flag + 1] : undefined;

  const easJson = JSON.parse(readFileSync(join(__dirname, '../eas.json'), 'utf8'));
  const dirty = run('git status --porcelain', {}, { capture: true }).trim().length > 0;
  const plan = planUpdate({ channel, message, easJson, dirty });
  if ('error' in plan) {
    console.error(plan.error);
    process.exit(1);
  }
  const targetChannel = /** @type {string} */ (channel);

  /** @type {Record<Platform, boolean>} */
  const compatible = { android: false, ios: false };
  for (const platform of PLATFORMS) {
    const runtimeVersion = runtimeVersionFor(platform, plan.environment, plan.env);
    compatible[platform] = hasCompatibleBuild(targetChannel, platform, runtimeVersion);
    console.log(
      `${platform}: runtime ${runtimeVersion} -- ${compatible[platform] ? 'a build on this channel can take it' : 'no build on this channel can take it, skipped'}`,
    );
  }

  const platform = platformsToPublish(compatible);
  if (!platform) {
    console.error(
      `Update refused: no finished ${targetChannel} build has this runtime version on either platform. ` +
        'The native layer changed since the last build (a native library, a plugin, a permission, an icon), ' +
        'so this change needs a store build, not an update.',
    );
    process.exit(1);
  }

  run(
    `npx eas update --channel ${targetChannel} --environment ${plan.environment} --platform ${platform} --message ${JSON.stringify(message)} --non-interactive`,
    plan.env,
  );
}

if (require.main === module) main();

module.exports = { CHANNELS, planUpdate, platformsToPublish };
