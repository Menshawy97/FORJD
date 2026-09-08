import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { decryptToken, EncryptedToken, encryptToken } from "./token-cipher";

/**
 * The injectable surface `whoop-oauth.service.ts` (Phase 7D) will actually call, bound
 * separately from `token-cipher.ts`'s pure functions for the same reason every other
 * `*-client.ts` factory in this codebase is split from its adapter (ADR-011): a provider that
 * reads its own config is verifiable only against real environment variables, not a unit test.
 *
 * There is exactly one encryption key configured today (`TOKEN_ENCRYPTION_KEY`, at whichever
 * version `TOKEN_ENCRYPTION_KEY_VERSION` names -- defaulting to `1`). Introducing a second,
 * newer key during a future rotation means this factory grows a second env-var read into the
 * same `keys` map while the old one stays present, which is a small, additive change here --
 * not a change to `token-cipher.ts` or to any already-encrypted row.
 */
export const TOKEN_CIPHER = Symbol("TOKEN_CIPHER");

export interface TokenCipher {
  encrypt(plaintext: string): EncryptedToken;
  decrypt(encrypted: EncryptedToken): string;
}

export function createTokenCipher(config: ConfigService): TokenCipher {
  const currentVersion = config.get<number>("TOKEN_ENCRYPTION_KEY_VERSION", 1);
  const key = Buffer.from(config.getOrThrow<string>("TOKEN_ENCRYPTION_KEY"), "base64");
  const keys = { [currentVersion]: key };

  return {
    encrypt: (plaintext) => encryptToken(plaintext, { currentVersion, keys }),
    decrypt: (encrypted) => decryptToken(encrypted, { keys }),
  };
}

export const tokenCipherProvider: Provider = {
  provide: TOKEN_CIPHER,
  inject: [ConfigService],
  useFactory: createTokenCipher,
};
