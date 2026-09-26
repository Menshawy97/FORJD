import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { API_ORIGINS, cspConfig } from './security';

/**
 * 8.5 S11, L12-2: getforjd.com sent no CSP, HSTS, X-Frame-Options or Permissions-Policy, so the
 * waitlist form could be framed and there was no defence in depth against injected script.
 *
 * Two layers, because a CSP delivered in a `<meta>` tag cannot carry `frame-ancestors`:
 * - Astro's `security.csp` hashes every inline script on every page at build time and emits
 *   the policy as a `<meta>` tag -- no hand-kept hashes to drift (`cspConfig`, `security.ts`).
 * - `public/_headers` (Cloudflare Pages) sends the response headers a meta tag cannot.
 */
const WEB_ROOT = join(__dirname, '..', '..');
const headersFile = readFileSync(join(WEB_ROOT, 'public', '_headers'), 'utf8');

const directive = (name: string): string | undefined =>
  cspConfig.directives.find((entry) => entry.startsWith(`${name} `));

describe('Content-Security-Policy (Astro security.csp)', () => {
  it('only lets scripts come from the site itself, its own hashed inline scripts, and Turnstile', () => {
    expect(cspConfig.scriptDirective.resources).toEqual(["'self'", 'https://challenges.cloudflare.com']);
  });

  it('never allows arbitrary inline script', () => {
    expect(cspConfig.scriptDirective.resources).not.toContain("'unsafe-inline'");
    expect(JSON.stringify(cspConfig)).not.toContain("'unsafe-eval'");
  });

  it('allows Turnstile to render its challenge frame, and nothing else to be framed in', () => {
    expect(directive('frame-src')).toBe('frame-src https://challenges.cloudflare.com');
  });

  it('lets the waitlist form reach both API environments, and nowhere else', () => {
    expect(directive('connect-src')).toBe(`connect-src 'self' ${API_ORIGINS.join(' ')}`);
  });

  it("includes the waitlist form's own fallback API origin", () => {
    const form = readFileSync(join(WEB_ROOT, 'src', 'components', 'WaitlistForm.astro'), 'utf8');
    const fallback = /PUBLIC_API_URL \|\| '([^']+)'/.exec(form)?.[1];

    expect(fallback).toBeDefined();
    expect(API_ORIGINS).toContain(new URL(fallback as string).origin);
  });

  it('closes the usual injection routes: plugins, base-tag hijack, and form posts elsewhere', () => {
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('form-action')).toBe("form-action 'self'");
  });
});

describe('response headers (public/_headers)', () => {
  it('applies to every path', () => {
    expect(headersFile.split(/\r?\n/)[0]).toBe('/*');
  });

  it.each([
    ['Strict-Transport-Security', 'max-age=31536000'],
    ['X-Frame-Options', 'DENY'],
    ['Content-Security-Policy', "frame-ancestors 'none'"],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'],
  ])('sends %s: %s', (name, value) => {
    expect(headersFile).toMatch(new RegExp(`^\\s+${name}: ${value.replace(/[()]/g, '\\$&')}\\s*$`, 'm'));
  });
});
