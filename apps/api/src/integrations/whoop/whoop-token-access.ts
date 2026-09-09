import { WhoopConnectionRepository, WhoopConnectionRow } from "./whoop-connection.repository";
import type { WhoopOAuthService } from "./whoop-oauth.service";
import type { TokenCipher } from "../../common/crypto/token-cipher.provider";

/** Refresh this early relative to actual expiry -- a request already in flight when the
 *  token expires mid-call is worse than refreshing a minute before it strictly needs to. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Returns a usable, decrypted WHOOP access token for a user -- refreshing and persisting a
 * new one first if the stored token is at or near expiry. Shared by `WhoopProvider`
 * (`connect()`/`sync()`, Phase 7E) and the webhook handler (Phase 7F, which needs a token to
 * fetch the one changed record a webhook names but has no reason to go through the full
 * `HealthProvider` interface for that). Extracted here specifically so both call sites share
 * one refresh/expiry/error-handling policy rather than two copies drifting apart.
 *
 * Throws if there is no connection at all (nothing to work with -- the authorize/callback
 * round trip, Phase 7F, is what creates one), if there is no refresh token to renew with, or
 * if a refresh attempt itself fails -- marking the connection `expired` in the latter two
 * cases so `requestPermissions()` / a future "reconnect" UI can see it.
 */
export async function ensureUsableWhoopAccessToken(
  userId: string,
  connections: WhoopConnectionRepository,
  oauth: WhoopOAuthService,
  cipher: TokenCipher,
): Promise<string> {
  const row = await connections.findByUserId(userId);
  if (!row) {
    throw new Error(`WHOOP is not connected for user ${userId}.`);
  }

  const isFresh = row.expiresAt !== null && row.expiresAt.getTime() - REFRESH_SKEW_MS > Date.now();
  if (isFresh) {
    return cipher.decrypt({ ciphertext: row.encryptedAccessToken, keyVersion: row.tokenKeyVersion });
  }

  return refreshAndPersist(userId, row, connections, oauth, cipher);
}

async function refreshAndPersist(
  userId: string,
  row: WhoopConnectionRow,
  connections: WhoopConnectionRepository,
  oauth: WhoopOAuthService,
  cipher: TokenCipher,
): Promise<string> {
  if (!row.encryptedRefreshToken) {
    // No refresh token was ever stored (the `offline` scope was never granted, or it
    // predates this integration existing) -- there is nothing to refresh with, and
    // decrypting an empty string would only produce a confusing failure further down.
    await connections.updateStatus(userId, "expired");
    throw new Error(`WHOOP connection for user ${userId} has no refresh token to renew its access token with.`);
  }
  const refreshToken = cipher.decrypt({ ciphertext: row.encryptedRefreshToken, keyVersion: row.tokenKeyVersion });

  let tokens;
  try {
    tokens = await oauth.refresh(refreshToken);
  } catch (err) {
    await connections.updateStatus(userId, "expired");
    throw err;
  }

  const encryptedAccess = cipher.encrypt(tokens.access_token);
  const encryptedRefresh = cipher.encrypt(tokens.refresh_token);

  await connections.upsertTokens(userId, {
    status: "connected",
    externalUserId: row.externalUserId,
    encryptedAccessToken: encryptedAccess.ciphertext,
    encryptedRefreshToken: encryptedRefresh.ciphertext,
    tokenKeyVersion: encryptedAccess.keyVersion,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope,
  });

  return tokens.access_token;
}
