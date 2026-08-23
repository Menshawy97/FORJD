import type { ErrorEvent } from '@sentry/nestjs';

import {
  applyCrashDiagnosticsConsent,
  CRASH_DIAGNOSTICS_TAG,
  scrubUnlessDiagnosticsConsented,
} from './sentry-scrub';

describe('applyCrashDiagnosticsConsent', () => {
  const scope = () => ({ setTag: jest.fn() });

  it('marks the scope as consented when diagnostics are on', () => {
    const s = scope();

    applyCrashDiagnosticsConsent(s, true);

    expect(s.setTag).toHaveBeenCalledWith(CRASH_DIAGNOSTICS_TAG, 'on');
  });

  it('marks the scope explicitly off rather than leaving it unset', () => {
    const s = scope();

    applyCrashDiagnosticsConsent(s, false);

    expect(s.setTag).toHaveBeenCalledWith(CRASH_DIAGNOSTICS_TAG, 'off');
  });

  /**
   * The round trip is what actually matters: whatever this function writes must be readable
   * by the scrubber. Asserting the two halves separately would let the marker value drift in
   * one of them.
   */
  it('writes a value the scrubber accepts', () => {
    const tags: Record<string, string> = {};
    applyCrashDiagnosticsConsent({ setTag: (k, v) => (tags[k] = v) }, true);

    const kept = scrubUnlessDiagnosticsConsented({
      event_id: 'e1',
      user: { id: 'user-1' },
      tags,
    } as never);

    expect(kept?.user).toEqual({ id: 'user-1' });
  });

  it('writes a value the scrubber rejects when consent is off', () => {
    const tags: Record<string, string> = {};
    applyCrashDiagnosticsConsent({ setTag: (k, v) => (tags[k] = v) }, false);

    const scrubbed = scrubUnlessDiagnosticsConsented({
      event_id: 'e1',
      user: { id: 'user-1' },
      tags,
    } as never);

    expect(scrubbed?.user).toBeUndefined();
  });
});

/**
 * This logic lives in its own module rather than inline in `instrument.ts` because
 * `instrument.ts` is excluded from coverage (it runs before Nest bootstraps and cannot be
 * imported into a test without initialising the SDK). A consent rule that nothing can test
 * is a consent rule nobody can trust — so the decision is here and `instrument.ts` only
 * calls it.
 */
describe('scrubUnlessDiagnosticsConsented', () => {
  const event = (over: Partial<ErrorEvent> = {}): ErrorEvent =>
    ({ event_id: 'e1', user: { id: 'user-1', email: 'ada@example.com' }, ...over }) as ErrorEvent;

  /**
   * Fail closed. An event carrying no tag at all is the common case — it comes from a code
   * path that never read this user's settings — and the safe reading of "we do not know
   * whether they consented" is "they did not".
   */
  it('removes the user identifier when nothing says consent was given', () => {
    const scrubbed = scrubUnlessDiagnosticsConsented(event());

    expect(scrubbed?.user).toBeUndefined();
  });

  it('removes the user identifier when diagnostics are explicitly off', () => {
    const scrubbed = scrubUnlessDiagnosticsConsented(
      event({ tags: { [CRASH_DIAGNOSTICS_TAG]: 'off' } }),
    );

    expect(scrubbed?.user).toBeUndefined();
  });

  it('keeps the user identifier only when diagnostics are explicitly on', () => {
    const scrubbed = scrubUnlessDiagnosticsConsented(
      event({ tags: { [CRASH_DIAGNOSTICS_TAG]: 'on' } }),
    );

    expect(scrubbed?.user).toEqual({ id: 'user-1', email: 'ada@example.com' });
  });

  /**
   * Any value other than the exact opt-in marker is treated as absence. A typo or a stale
   * tag format must degrade to scrubbing, never to sending.
   */
  it('treats an unrecognised tag value as no consent', () => {
    const scrubbed = scrubUnlessDiagnosticsConsented(
      event({ tags: { [CRASH_DIAGNOSTICS_TAG]: 'true' } }),
    );

    expect(scrubbed?.user).toBeUndefined();
  });

  it('still reports the error itself — only the identifier is removed', () => {
    const scrubbed = scrubUnlessDiagnosticsConsented(event());

    expect(scrubbed).not.toBeNull();
    expect(scrubbed?.event_id).toBe('e1');
  });

  it('handles an event that carries no user at all', () => {
    const scrubbed = scrubUnlessDiagnosticsConsented(event({ user: undefined }));

    expect(scrubbed?.user).toBeUndefined();
  });
});
