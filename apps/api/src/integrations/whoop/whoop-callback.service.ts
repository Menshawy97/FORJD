import { Inject, Injectable } from "@nestjs/common";

import { WhoopConnectionRepository } from "./whoop-connection.repository";
import { WHOOP_CLIENT, type WhoopClient } from "./whoop-client";
import { WhoopOAuthService } from "./whoop-oauth.service";
import { TOKEN_CIPHER, type TokenCipher } from "../../common/crypto/token-cipher.provider";

export interface WhoopCallbackResult {
  userId: string;
}

/**
 * Completes the OAuth round trip `POST /authorize` (via `WhoopConnectionRepository
 * .setPendingState`) and `GET /callback` bridge through `oauth_state` -- kept out of
 * `WhoopController` so it is unit-testable without an HTTP layer, matching every other
 * controller/service split in this codebase.
 *
 * Fetches the caller's WHOOP profile specifically to learn WHOOP's own numeric user id
 * (`external_user_id`) -- the only thing a later incoming webhook carries that can identify
 * which internal user it belongs to (`docs/product/phase-7-plan.md` slice 7F).
 */
@Injectable()
export class WhoopCallbackService {
  constructor(
    private readonly oauth: WhoopOAuthService,
    @Inject(WHOOP_CLIENT) private readonly client: WhoopClient,
    private readonly connections: WhoopConnectionRepository,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
  ) {}

  /** `null` for a `state` nobody issued or that has expired -- the caller (the controller)
   *  treats that identically to any other failed callback, since there is no internal user
   *  to attribute an error to in that case. */
  async completeAuthorization(state: string, code: string): Promise<WhoopCallbackResult | null> {
    const connection = await this.connections.findByOAuthState(state);
    if (!connection) {
      return null;
    }

    const tokens = await this.oauth.exchangeCode(code);
    const profile = await this.client.getProfile(tokens.access_token);

    const encryptedAccess = this.cipher.encrypt(tokens.access_token);
    const encryptedRefresh = this.cipher.encrypt(tokens.refresh_token);

    await this.connections.upsertTokens(connection.userId, {
      status: "connected",
      externalUserId: String(profile.user_id),
      encryptedAccessToken: encryptedAccess.ciphertext,
      encryptedRefreshToken: encryptedRefresh.ciphertext,
      tokenKeyVersion: encryptedAccess.keyVersion,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope,
    });

    return { userId: connection.userId };
  }
}
