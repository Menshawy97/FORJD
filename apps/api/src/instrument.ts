import * as Sentry from '@sentry/nestjs';

// Must be imported before any instrumented module. An empty DSN leaves the SDK inert,
// so local development needs no Sentry account.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0,
  // Health data must never leave the system through error reporting (CLAUDE.md rule 15).
  sendDefaultPii: false,
});
