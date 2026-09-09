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

/**
 * Reads `TOKEN_ENCRYPTION_KEY` lazily, on first actual `encrypt`/`decrypt` call -- not at
 * factory construction. `tokenCipherProvider` is instantiated eagerly as part of Nest's DI
 * graph the moment any module that imports it boots (`WhoopModule`, Phase 7F), so an eager
 * `getOrThrow` here would crash the *entire* API's startup in any environment that has not
 * configured WHOOP yet -- which, per `docs/product/phase-7-plan.md` decision 1, is every
 * real environment today (development, staging, and production all still run with no real
 * WHOOP credentials). This is exactly what happened: the 7F merge that first registered
 * `WhoopModule` broke the staging Cloud Run deploy outright ("container failed to start and
 * listen on the port"), because `deploy-api.yml` never provisioned `TOKEN_ENCRYPTION_KEY` as
 * a secret. Deferring the read means the API boots fine everywhere, and only a request that
 * actually needs to encrypt or decrypt a WHOOP token fails, with a clear error naming the
 * missing variable, rather than the whole process refusing to start.
 */
export function createTokenCipher(config: ConfigService): TokenCipher {
  const resolveKeys = (): { currentVersion: number; keys: Record<number, Buffer> } => {
    const currentVersion = config.get<number>("TOKEN_ENCRYPTION_KEY_VERSION", 1);
    const key = Buffer.from(config.getOrThrow<string>("TOKEN_ENCRYPTION_KEY"), "base64");
    return { currentVersion, keys: { [currentVersion]: key } };
  };

  return {
    encrypt: (plaintext) => {
      const { currentVersion, keys } = resolveKeys();
      return encryptToken(plaintext, { currentVersion, keys });
    },
    decrypt: (encrypted) => {
      const { keys } = resolveKeys();
      return decryptToken(encrypted, { keys });
    },
  };
}

export const tokenCipherProvider: Provider = {
  provide: TOKEN_CIPHER,
  inject: [ConfigService],
  useFactory: createTokenCipher,
};
