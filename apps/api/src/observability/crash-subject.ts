import * as Sentry from '@sentry/nestjs';

import type { CrashConsentLookup } from './sentry-scrub';

/** The minimum of Sentry's Scope this module needs, so it can be tested without the SDK. */
export interface UserScope {
  setUser(user: { id: string } | null): unknown;
}

let registeredLookup: CrashConsentLookup | null = null;

/**
 * Called once Nest has built `PrivacyService` (`CrashConsentRegistrar`). Until then, and after
 * shutdown, a crash tied to a user is not sent — see `createCrashReportFilter`.
 */
export function registerCrashConsentLookup(lookup: CrashConsentLookup | null): void {
  registeredLookup = lookup;
}

export function currentCrashConsentLookup(): CrashConsentLookup | null {
  return registeredLookup;
}

/**
 * Records whose request this is, so a crash later in it can be checked against that person's
 * crash-diagnostics choice. Only the id, and only on this request's own scope; it is removed
 * again in `beforeSend` unless they opted in. Costs no database read: the choice is read only
 * if a crash actually happens.
 */
export function markCrashSubject(userId: string, scope: UserScope = Sentry.getIsolationScope()): void {
  scope.setUser({ id: userId });
}
