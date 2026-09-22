import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';

/**
 * The mobile client is a native app in production and never sends an `Origin` header, so
 * CORS is invisible to it there. It matters in two places: `expo start`'s web preview and
 * any browser-based debugging of the dev bundle, both of which run from a LAN IP
 * (`http://192.168.x.x:8081`) or an `exp://` origin, never `localhost` (the phone's
 * `localhost` is the phone itself, not the dev machine -- see apps/mobile/README.md); and,
 * since ADR-051, getforjd.com's waitlist form.
 *
 * Two modes, chosen by whether `ALLOWED_WEB_ORIGINS` is set:
 *
 * - **Unset** (today's dev machines, and any environment that has not opted in): reflect
 *   any origin back. Safe only because this API authenticates with a Bearer token in the
 *   `Authorization` header, not a cookie, so an arbitrary site echoing this API's CORS
 *   headers cannot ride a signed-in user's session the way it could with cookie-based auth
 *   (no CSRF surface to widen).
 * - **Set** (production and staging, ADR-051 point 6): a comma-separated allowlist --
 *   `https://getforjd.com,https://www.getforjd.com` in production, plus the Pages preview
 *   domain in staging. The dev-time Expo web preview never sets this variable, so it keeps
 *   working exactly as before.
 *
 * `credentials` stays off in both modes -- see cors.spec.ts, which pins this combination.
 */
export function applyCors(app: INestApplication, config: ConfigService): void {
  const allowlist = config
    .get<string>('ALLOWED_WEB_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: allowlist.length > 0 ? allowlist : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // DO NOT add `credentials: true` here without re-reading the comment above in full.
    // Noted 2026-09-16 (audit-remediation-plan.md R11): reflecting any origin is safe only
    // because credentials are off. Enabling credentials while any origin path still
    // reflects turns this into an open CORS misconfiguration.
  });
}
