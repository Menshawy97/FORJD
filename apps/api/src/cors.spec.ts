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
 * The assertion is deliberately exact (`toHaveBeenCalledWith`, not `objectContaining`).
 * `origin: true` reflects whatever Origin the caller sent, which is safe here only because
 * this API authenticates with a Bearer token rather than a cookie — there is no ambient
 * credential for a hostile page to ride. If someone later adds cookie/session auth, that
 * combination becomes a CSRF hole, and pinning the exact object means this test fails and
 * forces the conversation instead of silently permitting it.
 */
describe('applyCors', () => {
  it('reflects any origin, and allows only the methods and headers the client uses', () => {
    const enableCors = jest.fn();
    const app = { enableCors } as unknown as INestApplication;

    applyCors(app);

    expect(enableCors).toHaveBeenCalledTimes(1);
    expect(enableCors).toHaveBeenCalledWith({
      origin: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  });

  it('does not enable credentials, which is what makes reflecting any origin safe', () => {
    const enableCors = jest.fn();
    const app = { enableCors } as unknown as INestApplication;

    applyCors(app);

    // Asserted separately and by name because this is the single property that decides
    // whether `origin: true` is reasonable or a vulnerability: with `credentials: true` the
    // browser would attach cookies to cross-site requests from any page on the internet.
    const options = enableCors.mock.calls[0][0] as Record<string, unknown>;
    expect(options.credentials).toBeUndefined();
  });
});
