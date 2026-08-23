import type { ErrorEvent } from '@sentry/nestjs';

/**
 * The tag an authenticated request sets once its privacy settings have actually been read.
 * Its only recognised value is `'on'`; everything else, including absence, means no consent.
 */
export const CRASH_DIAGNOSTICS_TAG = 'crash_diagnostics';

/** The single value that counts as consent. Compared exactly — see the fail-closed note. */
const CONSENTED = 'on';

/**
 * Removes the user identifier from a crash report unless that user turned crash diagnostics
 * on. Gives the `crashDiagnostics` flag something that actually reads it, rather than leaving
 * it a stored boolean nobody enforces.
 *
 * **It fails closed.** Only the exact marker `'on'` keeps the identifier; absence, `'off'`,
 * and any unrecognised value all scrub. That matters because most events come from code paths
 * that never read this user's settings — a crash during bootstrap, an unauthenticated
 * request, a background job — and for those the honest answer is "we do not know", which must
 * behave like "no". Defaulting the other way would leak an identifier every time the
 * consent lookup simply had not happened.
 *
 * The error itself is still reported. The flag governs whether the report can be tied to a
 * person, not whether the crash is fixed.
 *
 * This is **not** the mechanism that keeps health data out of Sentry — CLAUDE.md rule 15
 * forbids that unconditionally, regardless of any toggle's position, and `sendDefaultPii` is
 * off besides. Device-side enforcement is separate and also necessary: a crash can happen
 * before any network call succeeds, so the server can never be the only place this holds.
 */
/** The minimum of Sentry's Scope this module needs, so it can be tested without the SDK. */
export interface TaggableScope {
  setTag(key: string, value: string): unknown;
}

/**
 * Records this user's crash-diagnostics choice on the current scope, so events raised later
 * in the same request carry it.
 *
 * Called from the one place that has just read the real setting, rather than from a cache.
 * A request that never reads the setting leaves no tag, and `scrubUnlessDiagnosticsConsented`
 * treats that as no consent — which is why the absence case is safe rather than merely
 * unhandled.
 */
export function applyCrashDiagnosticsConsent(scope: TaggableScope, enabled: boolean): void {
  scope.setTag(CRASH_DIAGNOSTICS_TAG, enabled ? CONSENTED : 'off');
}

export function scrubUnlessDiagnosticsConsented(event: ErrorEvent): ErrorEvent | null {
  if (event.tags?.[CRASH_DIAGNOSTICS_TAG] === CONSENTED) {
    return event;
  }

  // Deleting rather than blanking: an empty user object still tells Sentry there was a user,
  // and would group events by a placeholder identity.
  delete event.user;

  return event;
}
