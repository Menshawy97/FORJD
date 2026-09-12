import { ConflictException, Inject, Injectable } from "@nestjs/common";

import { WhoopConnectionRepository } from "./whoop-connection.repository";
import { WHOOP_CLIENT, type WhoopClient } from "./whoop-client";
import { WhoopOAuthService } from "./whoop-oauth.service";
import { TOKEN_CIPHER, type TokenCipher } from "../../common/crypto/token-cipher.provider";

export interface WhoopCallbackResult {
  userId: string;
}

/**
 * Postgres unique_violation on `external_connections_provider_external_user_id_unique` (R6,
 * H5) -- the partial unique index (`WHERE external_user_id IS NOT NULL`) that rejects a second
 * connection claiming a WHOOP account another user already holds. Same wrapping problem
 * `users.repository.ts`'s `isUniqueViolation` documents: drizzle-orm wraps every node-postgres
 * query failure in a `DrizzleQueryError`, with the real pg error -- and its
 * `.code`/`.constraint` -- attached as `.cause` rather than as a top-level property, so both
 * locations must be checked.
 */
function isDuplicateExternalUserIdViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (code !== "23505" && causeCode !== "23505") {
    return false;
  }

  const constraint = (error as { constraint?: unknown } | null)?.constraint;
  const causeConstraint = (error as { cause?: { constraint?: unknown } } | null)?.cause?.constraint;
  return (
    constraint === "external_connections_provider_external_user_id_unique" ||
    causeConstraint === "external_connections_provider_external_user_id_unique"
  );
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

    try {
      await this.connections.upsertTokens(connection.userId, {
        status: "connected",
        externalUserId: String(profile.user_id),
        encryptedAccessToken: encryptedAccess.ciphertext,
        encryptedRefreshToken: encryptedRefresh.ciphertext,
        tokenKeyVersion: encryptedAccess.keyVersion,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope,
      });
    } catch (error: unknown) {
      // This WHOOP account (external_user_id) is already linked to a different internal user
      // -- reject outright rather than moving the association, which would silently start
      // routing one person's WHOOP webhooks and syncs into another person's account (H5).
      if (isDuplicateExternalUserIdViolation(error)) {
        throw new ConflictException("This WHOOP account is already connected to another user.");
      }

      throw error;
    }

    return { userId: connection.userId };
  }
}
