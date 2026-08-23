import * as Sentry from '@sentry/nestjs';

import { scrubUnlessDiagnosticsConsented } from './observability/sentry-scrub';

// Must be imported before any instrumented module. An empty DSN leaves the SDK inert,
// so local development needs no Sentry account.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0,
  // Health data must never leave the system through error reporting (CLAUDE.md rule 15).
  sendDefaultPii: false,
  // Enforces the `crashDiagnostics` consent flag: without it the flag would be a stored
  // boolean nothing reads. The decision itself lives in its own module because this file is
  // excluded from coverage — it runs before Nest bootstraps and cannot be imported into a
  // test without initialising the SDK, and a consent rule nothing can test is one nobody can
  // trust. Note this is not what keeps health data out of Sentry; rule 15 does that
  // unconditionally, whatever the toggle says.
  beforeSend: scrubUnlessDiagnosticsConsented,
});
