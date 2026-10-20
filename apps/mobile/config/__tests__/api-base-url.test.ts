// docs/product/beta-readiness-plan.md, part 1. A production build must reach the production API: not
// a placeholder, not this computer, not staging, and never over plain http. `app.config.ts` runs
// this check at build time, so a wrong address fails the build instead of shipping.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkApiBaseUrl } from '../api-base-url';

const PRODUCTION_URL = 'https://forjd-api-production-772363715082.europe-west1.run.app';

describe('checkApiBaseUrl', () => {
  it('accepts the production API for a production build', () => {
    expect(checkApiBaseUrl('production', PRODUCTION_URL)).toBeNull();
  });

  it.each([
    ['nothing set', undefined, /not set/],
    ['the old placeholder', 'REPLACE_WITH_PRODUCTION_CLOUD_RUN_URL__see_docs', /placeholder/],
    ['this computer', 'http://localhost:3000', /this computer/],
    ['the emulator alias for this computer', 'http://10.0.2.2:3000', /this computer/],
    ['the loopback address', 'https://127.0.0.1:3000', /this computer/],
    ['the staging API', 'https://forjd-api-staging-772363715082.europe-west1.run.app', /staging/],
    ['plain http', 'http://forjd-api-production-772363715082.europe-west1.run.app', /https/],
    ['something that is not an address', 'production', /not an address/],
  ])('refuses %s for a production build', (_label, url, reason) => {
    expect(checkApiBaseUrl('production', url)).toMatch(reason);
  });

  it('checks the production-apk build (an installable copy of production) the same way', () => {
    expect(checkApiBaseUrl('production-apk', PRODUCTION_URL)).toBeNull();
    expect(checkApiBaseUrl('production-apk', 'https://forjd-api-staging-772363715082.europe-west1.run.app')).toMatch(
      /staging/,
    );
  });

  it('leaves development and staging builds alone', () => {
    expect(checkApiBaseUrl('development', 'http://localhost:3000')).toBeNull();
    expect(checkApiBaseUrl('staging', 'https://forjd-api-staging-772363715082.europe-west1.run.app')).toBeNull();
    expect(checkApiBaseUrl(undefined, undefined)).toBeNull();
  });
});

describe('eas.json', () => {
  const eas = JSON.parse(readFileSync(join(__dirname, '../../eas.json'), 'utf8')) as {
    build: Record<string, { env?: Record<string, string>; extends?: string; android?: { buildType?: string } }>;
  };
  const production = eas.build.production?.env ?? {};
  const staging = eas.build.staging?.env ?? {};

  it('gives the production profile an address the build check accepts', () => {
    expect(checkApiBaseUrl('production', production.API_BASE_URL)).toBeNull();
    expect(production.API_BASE_URL).not.toBe(staging.API_BASE_URL);
  });

  it('gives the production profile the Google web client (owner decision 2026-10-14)', () => {
    expect(production.GOOGLE_WEB_CLIENT_ID).toBe(staging.GOOGLE_WEB_CLIENT_ID);
  });

  it('makes production-apk an installable APK of production, with nothing of its own to drift', () => {
    const apk = eas.build['production-apk'];
    expect(apk?.extends).toBe('production');
    expect(apk?.android?.buildType).toBe('apk');
    expect(apk?.env).toBeUndefined();
  });
});
