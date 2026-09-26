import type { AstroUserConfig } from 'astro';

/**
 * The site's Content-Security-Policy (8.5 S11, L12-2), given to Astro's `security.csp` in
 * `astro.config.mjs`. Astro hashes every inline script on every page at build time and puts the
 * policy in a `<meta>` tag, so an inline script that changes is re-hashed automatically.
 *
 * - **Scripts:** the site's own files and hashed inline scripts, plus Cloudflare Turnstile (loaded
 *   by the waitlist form). No `'unsafe-inline'`, no `'unsafe-eval'`.
 * - **Styles:** `'unsafe-inline'`, deliberately. The pages use `style=""` attributes, which a
 *   hash-based `style-src` would block, and Astro emits no style hashes once `'unsafe-inline'` is
 *   present. Injected CSS is a far smaller risk than injected script, which stays locked down.
 * - **Connections:** the waitlist form posts to the API. Production and preview builds point at
 *   different environments (`PUBLIC_API_URL`), and this file is shared by both, so both are listed.
 *
 * `frame-ancestors` cannot be set from a `<meta>` tag; `public/_headers` sends it as a header.
 */
export const API_ORIGINS = [
  'https://forjd-api-production-772363715082.europe-west1.run.app',
  'https://forjd-api-staging-772363715082.europe-west1.run.app',
] as const;

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** Astro's own type for `security.csp` (the object form), so a directive typo fails `astro check`. */
type CspConfig = Exclude<NonNullable<NonNullable<AstroUserConfig['security']>['csp']>, boolean>;

export const cspConfig = {
  directives: [
    "default-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${API_ORIGINS.join(' ')}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ],
  scriptDirective: { resources: ["'self'", TURNSTILE_ORIGIN] },
  styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
} satisfies CspConfig;
