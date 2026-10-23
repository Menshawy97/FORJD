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

type Git = { dirty: boolean; pushed: boolean; onOriginMain: boolean };
const { APP_CONFIG_ENV, CHANNELS, planUpdate, platformsToPublish, updateEnv } = require('../../scripts/publish-update.js') as {
  APP_CONFIG_ENV: string[];
  CHANNELS: Record<string, { profile: string; environment: string }>;
  planUpdate: (input: {
    channel: string | undefined;
    message: string | undefined;
    easJson: unknown;
    git: Git;
  }) => { error: string } | { profile: string; environment: string; env: Record<string, string> };
  platformsToPublish: (compatible: { android: boolean; ios: boolean }) => string | null;
  updateEnv: (processEnv: Record<string, string | undefined>, planEnv: Record<string, string>) => Record<string, string | undefined>;
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
  const clean: Git = { dirty: false, pushed: true, onOriginMain: true };
  const base = { message: 'Fix the rest timer label', easJson, git: clean };

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

  it.each(Object.keys(CHANNELS))('refuses a %s update from uncommitted changes', (channel) => {
    expect(planUpdate({ ...base, channel, git: { ...clean, dirty: true } })).toEqual({
      error: expect.stringMatching(/commit or stash/),
    });
  });

  it.each(Object.keys(CHANNELS))('refuses a %s update from a commit that is not on GitHub', (channel) => {
    expect(planUpdate({ ...base, channel, git: { ...clean, pushed: false } })).toEqual({
      error: expect.stringMatching(/push this commit/),
    });
  });

  it('ships production from origin/main only, staging from any pushed branch', () => {
    const branch = { ...clean, onOriginMain: false };
    expect(planUpdate({ ...base, channel: 'production', git: branch })).toEqual({
      error: expect.stringMatching(/origin\/main only/),
    });
    expect(planUpdate({ ...base, channel: 'staging', git: branch })).not.toHaveProperty('error');
  });
});

describe('updateEnv: nothing from this computer reaches the update', () => {
  it('names every variable app.config.ts reads', () => {
    const source = readFileSync(join(PROJECT_ROOT, 'app.config.ts'), 'utf8');
    const read = new Set([...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual([...APP_CONFIG_ENV].sort());
  });

  it("drops this shell's values and keeps only the profile's", () => {
    const shell = { PATH: '/bin', APPLE_HEALTH_ENABLED: 'true', API_BASE_URL: 'http://localhost:3000', GOOGLE_IOS_URL_SCHEME: 'x' };
    const env = updateEnv(shell, { API_BASE_URL: 'https://api.example', FORJD_UPDATE_PROFILE: 'production' });
    expect(env).toEqual({
      PATH: '/bin',
      API_BASE_URL: 'https://api.example',
      FORJD_UPDATE_PROFILE: 'production',
      EXPO_NO_DOTENV: '1',
    });
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
