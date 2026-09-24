import { markIntroShown, resetIntroForTests, shouldShowIntro } from '../intro-gate';

/**
 * The intro (#9, ADR-052) plays once per cold start. "Cold start" is this JS process: the
 * flag lives in module scope, so it survives the root layout re-mounting (fast refresh, a
 * remount after sign-out) but not the app being killed and reopened.
 */
describe('intro gate', () => {
  beforeEach(() => resetIntroForTests());

  it('shows the intro the first time it is asked', () => {
    expect(shouldShowIntro()).toBe(true);
  });

  it('does not show it again once it has been shown in this process', () => {
    markIntroShown();
    expect(shouldShowIntro()).toBe(false);
  });
});
