import { Inject, Injectable } from "@nestjs/common";

import { WhoopConnectionRepository } from "./whoop-connection.repository";
import { WHOOP_CLIENT, type WhoopClient } from "./whoop-client";
import { WhoopOAuthService } from "./whoop-oauth.service";
import { WhoopProvider } from "./whoop.provider";
import { TOKEN_CIPHER, type TokenCipher } from "../../common/crypto/token-cipher.provider";

/**
 * `WhoopProvider` is constructed per-user (Phase 7E), not itself a Nest singleton -- this is
 * the one place that actually builds one, so `WhoopController`/`WhoopSyncService`/
 * `WhoopWebhookService` never wire its four dependencies by hand.
 */
@Injectable()
export class WhoopProviderFactory {
  constructor(
    private readonly connections: WhoopConnectionRepository,
    private readonly oauth: WhoopOAuthService,
    @Inject(WHOOP_CLIENT) private readonly client: WhoopClient,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
  ) {}

  forUser(userId: string): WhoopProvider {
    return new WhoopProvider(userId, this.connections, this.oauth, this.client, this.cipher);
  }
}
