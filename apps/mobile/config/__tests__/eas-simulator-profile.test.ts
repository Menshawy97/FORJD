// docs/product/ios-no-account-plan.md, slice 2. An EAS iOS simulator build needs no Apple signing, so
// it is the compile check of the iPhone app before the Apple Developer account exists (ADR-007,
// ADR-068's check 2). It is the staging app, built for the simulator, and it must not change how the
// existing profiles build Android.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Profile = {
  extends?: string;
  distribution?: string;
  developmentClient?: boolean;
  env?: Record<string, string>;
  ios?: { simulator?: boolean };
  android?: unknown;
};

const eas = JSON.parse(readFileSync(join(__dirname, '../../eas.json'), 'utf8')) as {
  build: Record<string, Profile>;
};

// A release build (simulator, staging, production) bundles the JavaScript on EAS, and Metro resolves
// @forjd/domain and @forjd/contracts through their compiled dist/, which git does not hold. The first
// simulator build failed there; development builds never bundle, so none had shown it. EAS runs this
// script after installing dependencies, on both platforms.
describe('EAS build hook', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
  };

  it('compiles every workspace package the app depends on, after EAS installs dependencies', () => {
    const hook = pkg.scripts?.['eas-build-post-install'] ?? '';
    const workspaceDeps = Object.entries(pkg.dependencies ?? {}).filter(([, range]) => range.startsWith('workspace:'));
    expect(workspaceDeps.map(([name]) => name).sort()).toEqual(['@forjd/contracts', '@forjd/domain']);
    // `^...` is the app's workspace dependencies (not the app itself), built in dependency order.
    expect(hook).toBe('pnpm --filter "@forjd/mobile^..." run build');
  });
});

describe('EAS simulator profile', () => {
  const simulator = eas.build.simulator;

  it('exists and builds for the iOS simulator, which needs no Apple signing', () => {
    expect(simulator).toBeDefined();
    expect(simulator?.ios?.simulator).toBe(true);
  });

  it('is the staging app (same API and settings), not a development client', () => {
    expect(simulator?.extends).toBe('staging');
    expect(simulator?.developmentClient).not.toBe(true);
    expect(simulator?.env).toBeUndefined();
  });

  it('sets nothing for Android', () => {
    expect(simulator?.android).toBeUndefined();
  });

  it('leaves the existing profiles as they were', () => {
    for (const name of ['development', 'staging', 'production']) {
      expect(eas.build[name]?.ios).toBeUndefined();
    }
  });
});
