/**
 * @jest-environment node
 */
// ADR-071. Over-the-air updates for JavaScript-only changes: the runtime version is the native layer's
// fingerprint, launch never waits for the network (rule 6), and an update is published only through
// scripts/publish-update.js, which gives it the channel's own API address and the production check.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { introspectConfig, type IntrospectedConfig } from '../../jest/introspect-config';

const { CHANNELS, planUpdate, platformsToPublish } = require('../../scripts/publish-update.js') as {
  CHANNELS: Record<string, { profile: string; environment: string }>;
  planUpdate: (input: {
    channel: string | undefined;
    message: string | undefined;
    easJson: unknown;
    dirty: boolean;
  }) => { error: string } | { profile: string; environment: string; env: Record<string, string> };
  platformsToPublish: (compatible: { android: boolean; ios: boolean }) => string | null;
};

const PROJECT_ROOT = join(__dirname, '../..');
const easJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'eas.json'), 'utf8')) as {
  build: Record<string, { channel?: string; env?: Record<string, string> }>;
};

describe('app config', () => {
  let config: IntrospectedConfig;
  beforeAll(async () => {
    config = await introspectConfig();
  });

  it('uses the fingerprint of the native layer as the runtime version', () => {
    expect(config.runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it("asks this EAS project's update server", () => {
    expect(config.updates?.url).toBe(`https://u.expo.dev/${(config.extra?.eas as { projectId: string }).projectId}`);
  });

  it('never makes launch wait for the network: a new bundle runs from the next cold start', () => {
    expect(config.updates?.fallbackToCacheTimeout).toBe(0);
    expect(config.updates?.checkAutomatically).toBe('ON_LOAD');
  });

  it('writes the same into the Android manifest', () => {
    const manifest = config._internal.modResults.android.manifest as {
      manifest: { application: { 'meta-data': { $: Record<string, string> }[] }[] };
    };
    const meta = Object.fromEntries(
      (manifest.manifest.application[0]?.['meta-data'] ?? []).map((m) => [m.$['android:name'], m.$['android:value']]),
    );
    expect(meta['expo.modules.updates.ENABLED']).toBe('true');
    expect(meta['expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS']).toBe('0');
    expect(meta['expo.modules.updates.EXPO_UPDATE_URL']).toBe(config.updates?.url);
  });
});

describe('the production check while an update is published', () => {
  async function configWith(env: Record<string, string>): Promise<string> {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    delete childEnv.EAS_BUILD_PROFILE;
    const expoCli = require.resolve('expo/bin/cli', { paths: [PROJECT_ROOT] });
    try {
      await promisify(execFile)(process.execPath, [expoCli, 'config', '--type', 'public', '--json'], {
        cwd: PROJECT_ROOT,
        env: childEnv,
        maxBuffer: 32 * 1024 * 1024,
      });
      return 'accepted';
    } catch (error) {
      return String((error as { stderr?: string }).stderr ?? error);
    }
  }

  it('refuses a production update that would point at this computer', async () => {
    await expect(configWith({ FORJD_UPDATE_PROFILE: 'production', API_BASE_URL: 'http://localhost:3000' })).resolves.toMatch(
      /this computer/,
    );
  });

  it("accepts a production update with production's own address", async () => {
    await expect(
      configWith({ FORJD_UPDATE_PROFILE: 'production', API_BASE_URL: easJson.build.production?.env?.API_BASE_URL ?? '' }),
    ).resolves.toBe('accepted');
  });
});

describe('planUpdate', () => {
  const base = { message: 'Fix the rest timer label', easJson, dirty: false };

  it.each(Object.entries(CHANNELS))('%s publishes with its own build profile and EAS environment', (channel, target) => {
    const plan = planUpdate({ ...base, channel });
    expect(plan).toEqual({
      profile: target.profile,
      environment: target.environment,
      env: { ...easJson.build[target.profile]?.env, FORJD_UPDATE_PROFILE: target.profile },
    });
  });

  it('gives production the production API, never staging or this computer', () => {
    const plan = planUpdate({ ...base, channel: 'production' });
    expect('env' in plan && plan.env.API_BASE_URL).toBe(easJson.build.production?.env?.API_BASE_URL);
  });

  it('matches each channel to the profile that builds for it in eas.json', () => {
    for (const [channel, { profile }] of Object.entries(CHANNELS)) {
      expect(easJson.build[profile]?.channel).toBe(channel);
    }
  });

  it.each([undefined, 'development', 'main'])('refuses an unknown channel (%s)', (channel) => {
    expect(planUpdate({ ...base, channel })).toEqual({ error: expect.stringMatching(/Unknown channel/) });
  });

  it.each([undefined, '', '   '])('refuses an update without a message (%p)', (message) => {
    expect(planUpdate({ ...base, channel: 'staging', message })).toEqual({ error: expect.stringMatching(/-m/) });
  });

  it('refuses a production update whose profile points at staging', () => {
    const broken = structuredClone(easJson);
    broken.build.production!.env!.API_BASE_URL = easJson.build.staging?.env?.API_BASE_URL ?? '';
    expect(planUpdate({ ...base, easJson: broken, channel: 'production' })).toEqual({
      error: expect.stringMatching(/points at staging/),
    });
  });

  it('refuses a profile that builds for a different channel', () => {
    const broken = structuredClone(easJson);
    broken.build.staging!.channel = 'production';
    expect(planUpdate({ ...base, easJson: broken, channel: 'staging' })).toEqual({
      error: expect.stringMatching(/not "staging"/),
    });
  });

  it('refuses a production update from uncommitted changes, but lets staging try them', () => {
    expect(planUpdate({ ...base, channel: 'production', dirty: true })).toEqual({
      error: expect.stringMatching(/commit or stash/),
    });
    expect(planUpdate({ ...base, channel: 'staging', dirty: true })).not.toHaveProperty('error');
  });
});

describe('platformsToPublish', () => {
  it.each([
    [{ android: true, ios: true }, 'all'],
    [{ android: true, ios: false }, 'android'],
    [{ android: false, ios: true }, 'ios'],
    [{ android: false, ios: false }, null],
  ])('%p -> %p', (compatible, expected) => {
    expect(platformsToPublish(compatible)).toBe(expected);
  });
});
