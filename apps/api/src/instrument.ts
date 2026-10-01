import * as Sentry from '@sentry/nestjs';

import { currentCrashConsentLookup } from './observability/crash-subject';
import { createCrashReportFilter } from './observability/sentry-scrub';

// Must be imported before any instrumented module. An empty DSN leaves the SDK inert,
// so local development needs no Sentry account.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0,
  // Health data must never leave the system through error reporting (CLAUDE.md rule 15).
  sendDefaultPii: false,
  // Every report loses its text (messages, request, breadcrumbs, context), and a crash from a
  // user who turned crash diagnostics off is not sent at all. The decisions live in
  // `observability/` because this file is excluded from coverage — it runs before Nest
  // bootstraps and cannot be imported into a test without initialising the SDK, and a rule
  // nothing can test is one nobody can trust.
  beforeSend: createCrashReportFilter(currentCrashConsentLookup),
  // Breadcrumbs (console lines, HTTP calls) are free text; none is recorded in the first place.
  beforeBreadcrumb: () => null,
});
