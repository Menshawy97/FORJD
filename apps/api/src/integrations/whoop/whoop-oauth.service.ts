import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { WHOOP_CLIENT, type WhoopClient, type WhoopTokenResponse } from "./whoop-client";

const AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";

/**
 * The seven scopes this app requests -- the six `read:*` scopes covering every data type
 * Phase 7 ingests (recovery, sleep, workout, plus profile/body-measurement/cycles for
 * context) and `offline`, without which WHOOP never issues a refresh token
 * (`docs/product/phase-7-plan.md`'s WHOOP OAuth sources). `strain`/`recovery` composite
 * scores are out of scope for Phase 7 (decision D), but the scopes that would supply their
 * raw inputs are requested regardless since they overlap the readiness-input scopes anyway.
 */
const WHOOP_SCOPES = [
  "read:profile",
  "read:body_measurement",
  "read:cycles",
  "read:recovery",
  "read:sleep",
  "read:workout",
  "offline",
] as const;

/** WHOOP's own docs: "must be eight characters long if you need to generate it yourself." */
const MINIMUM_STATE_LENGTH = 8;

/**
 * Owns the parts of the WHOOP OAuth round trip that are not raw HTTP -- the authorize-
 * redirect URL (pure) and delegating code exchange / refresh to `WhoopClient`. Kept separate
 * from `WhoopClient` itself so the client stays a thin, generic HTTP wrapper and this class
 * holds the WHOOP-specific policy (which scopes, which state length, which redirect URI).
 */
@Injectable()
export class WhoopOAuthService {
  constructor(
    @Inject(WHOOP_CLIENT) private readonly client: WhoopClient,
    private readonly clientId: string,
    private readonly redirectUri: string,
  ) {}

  buildAuthorizeUrl(state: string): string {
    if (state.length < MINIMUM_STATE_LENGTH) {
      throw new Error(`WHOOP OAuth state must be at least ${MINIMUM_STATE_LENGTH} characters long.`);
    }

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", WHOOP_SCOPES.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }

  exchangeCode(code: string): Promise<WhoopTokenResponse> {
    return this.client.exchangeAuthorizationCode(code, this.redirectUri);
  }

  refresh(refreshToken: string): Promise<WhoopTokenResponse> {
    return this.client.refreshAccessToken(refreshToken);
  }
}

/** `config.get(..., "")`, not `getOrThrow` -- same reasoning as `whoop-client.ts`'s
 *  `whoopClientProvider`: this factory runs eagerly at module boot, and no real environment
 *  has WHOOP credentials configured yet. `buildAuthorizeUrl` builds a URL either way; an
 *  empty `client_id`/`redirect_uri` only produces a URL WHOOP itself would reject if actually
 *  opened, not a crashed API process. */
export const whoopOAuthServiceProvider = {
  provide: WhoopOAuthService,
  inject: [WHOOP_CLIENT, ConfigService],
  useFactory: (client: WhoopClient, config: ConfigService): WhoopOAuthService =>
    new WhoopOAuthService(client, config.get<string>("WHOOP_CLIENT_ID", ""), config.get<string>("WHOOP_REDIRECT_URI", "")),
};
