import { TurnstileClient } from '../../src/integrations/turnstile/turnstile-client';

/**
 * An in-memory `TurnstileClient` for e2e specs, in the spirit of `FakeAuthProvider`: real HTTP
 * against the real app, with only the third-party edge substituted. Any token verifies except
 * the ones in `rejectedTokens`, so a spec can request a specific failure without reaching
 * Cloudflare.
 */
export class FakeTurnstileClient implements TurnstileClient {
  readonly verifiedTokens: string[] = [];

  constructor(private readonly rejectedTokens: ReadonlySet<string> = new Set()) {}

  async verify(token: string): Promise<boolean> {
    this.verifiedTokens.push(token);
    return !this.rejectedTokens.has(token);
  }
}
