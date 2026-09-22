import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';

import { applyCors } from './cors';

/**
 * `applyCors` is one call, but it is a security policy rather than configuration noise, so
 * it is pinned here rather than left to the e2e spec alone. Two reasons the e2e coverage is
 * not sufficient on its own: it runs under `test:e2e`, a separate Jest project that
 * `test:cov` does not include, so this file would otherwise sit at zero unit coverage; and
 * an e2e request only proves *one* origin was allowed, not that the policy is exactly the
 * shape intended.
 *
 * ADR-051 point 6 narrows CORS to an allowlist read from `ALLOWED_WEB_ORIGINS`
 * (comma-separated), for production and staging. Everywhere that variable is unset --
 * today's dev machines, and any environment that has not opted in -- the behaviour is
 * unchanged from before: reflect whatever `Origin` the caller sent, which the docblock in
 * `cors.ts` explains is safe only because this API never turns on `credentials`.
 *
 * Noted 2026-09-16 (R11, audit-remediation-plan.md): this is the exact day the
 * reflect-without-credentials combination was re-confirmed safe and worth pinning. DO NOT
 * add `credentials: true` to `applyCors` while any origin path still reflects rather than
 * allowlists, without re-deriving this from scratch -- see `cors.ts`'s own docblock.
 */
describe('applyCors', () => {
  const config = (allowedWebOrigins?: string) =>
    ({
      get: (_key: string, fallback: string) => allowedWebOrigins ?? fallback,
    }) as unknown as ConfigService;

  it('reflects any origin when ALLOWED_WEB_ORIGINS is unset, same as before this ADR', () => {
    const enableCors = jest.fn();
    const app = { enableCors } as unknown as INestApplication;

    applyCors(app, config());

    expect(enableCors).toHaveBeenCalledTimes(1);
    expect(enableCors).toHaveBeenCalledWith({
      origin: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  });

  it('narrows to an explicit allowlist when ALLOWED_WEB_ORIGINS is set', () => {
    const enableCors = jest.fn();
    const app = { enableCors } as unknown as INestApplication;

    applyCors(app, config('https://getforjd.com,https://www.getforjd.com'));

    const options = enableCors.mock.calls[0][0] as Record<string, unknown>;
    expect(options.origin).toEqual(['https://getforjd.com', 'https://www.getforjd.com']);
  });

  it('trims whitespace and drops empty entries, so a trailing comma cannot allow every origin', () => {
    const enableCors = jest.fn();
    const app = { enableCors } as unknown as INestApplication;

    applyCors(app, config(' https://getforjd.com , https://www.getforjd.com, '));

    const options = enableCors.mock.calls[0][0] as Record<string, unknown>;
    expect(options.origin).toEqual(['https://getforjd.com', 'https://www.getforjd.com']);
  });

  it('does not enable credentials, in either mode', () => {
    const enableCors = jest.fn();
    const app = { enableCors } as unknown as INestApplication;

    applyCors(app, config('https://getforjd.com'));

    // Asserted separately and by name because this is the single property that decides
    // whether reflecting or allowlisting an origin is reasonable or a vulnerability: with
    // `credentials: true` the browser would attach cookies to cross-site requests.
    const options = enableCors.mock.calls[0][0] as Record<string, unknown>;
    expect(options.credentials).toBeUndefined();
  });
});
