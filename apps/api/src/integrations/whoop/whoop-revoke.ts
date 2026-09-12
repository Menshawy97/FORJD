import { WhoopConnectionRepository } from "./whoop-connection.repository";
import type { WhoopClient } from "./whoop-client";
import type { TokenCipher } from "../../common/crypto/token-cipher.provider";

/**
 * Revokes the WHOOP grant, then wipes the locally stored tokens. Shared by
 * `AccountDeletionService` (R3, C1) and `WhoopProvider.disconnect()` (R5, H1) -- both of
 * which, before this existed, either would have or actually did leave the grant live at
 * WHOOP and the encrypted tokens sitting in the row, with only a status column flipped.
 *
 * Revoke before wipe, deliberately: the wipe destroys the very access token the revoke call
 * needs to identify the grant. And a revoke that fails still wipes the local tokens -- the
 * caller asked to disconnect (or delete their account entirely), and keeping tokens around
 * locally because a vendor call failed is the wrong trade in either case.
 *
 * A no-op for a user with no connection, or one that never completed the OAuth round trip
 * (`encryptedAccessToken` is the empty-string placeholder `setPendingState` writes) -- there
 * is no grant to revoke and nothing to wipe.
 */
export async function revokeAndClearWhoopConnection(
  userId: string,
  connections: WhoopConnectionRepository,
  client: WhoopClient,
  cipher: TokenCipher,
): Promise<void> {
  const row = await connections.findByUserId(userId);
  if (!row || !row.encryptedAccessToken) {
    return;
  }

  try {
    const accessToken = cipher.decrypt({ ciphertext: row.encryptedAccessToken, keyVersion: row.tokenKeyVersion });
    await client.revokeToken(accessToken);
  } catch {
    // Deliberately swallowed -- see this function's own docblock.
  } finally {
    await connections.clearTokens(userId);
  }
}
