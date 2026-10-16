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
