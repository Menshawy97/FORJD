import { INestApplication } from '@nestjs/common';

/**
 * The mobile client is a native app in production and never sends an `Origin` header, so
 * CORS is invisible to it there. It only matters for `expo start`'s web preview and any
 * browser-based debugging of the dev bundle, both of which run from a LAN IP
 * (`http://192.168.x.x:8081`) or an `exp://` origin, never `localhost` (the phone's
 * `localhost` is the phone itself, not the dev machine — see apps/mobile/README.md).
 *
 * Reflecting any origin back (rather than an allowlist) is deliberate: this API
 * authenticates with a Bearer token in the `Authorization` header, not a cookie, so an
 * arbitrary site echoing this API's CORS headers cannot ride a signed-in user's session the
 * way it could with cookie-based auth (no CSRF surface to widen). If a browsable web/
 * marketing surface for this API is added later, narrow this to an explicit allowlist then.
 */
export function applyCors(app: INestApplication): void {
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}
