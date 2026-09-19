import { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Number of reverse-proxy hops in front of the API whose `X-Forwarded-For` entry we trust.
 *
 * The API runs on Google Cloud Run (ADR-015). Exactly one proxy -- Google's Front End --
 * sits between the internet and the container, and it appends the address it received the
 * connection from as the RIGHTMOST `X-Forwarded-For` entry. Anything to its left was
 * supplied by the client and is untrusted.
 *
 * With `trust proxy` = 1, Express treats only the TCP peer (the GFE) as trusted and takes
 * `req.ip` from the entry that peer added: the real client. That is what the global
 * `ThrottlerGuard` keys on. Consequences of the alternatives:
 *  - unset: `req.ip` is the GFE's address, so every client shares one rate-limit bucket
 *    and a single abusive caller locks everyone out;
 *  - `true` (or a hop count that is too high): the client-controlled leftmost entry becomes
 *    `req.ip`, so rotating a spoofed `X-Forwarded-For` value bypasses every limit.
 *
 * Raise this only if another proxy/CDN is put in front of Cloud Run (e.g. a load balancer
 * with Cloud Armor adds a hop) -- and update the spec alongside.
 */
export const TRUSTED_PROXY_HOPS = 1;

export function configureTrustProxy(app: NestExpressApplication): void {
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
}
