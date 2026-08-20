import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, JWTVerifyGetKey } from 'jose';

/**
 * The public keys Supabase signs access tokens with, fetched once and cached in process.
 *
 * This is what lets `verifyAccessToken` answer without a network round trip (ADR-012).
 * `createRemoteJWKSet` fetches lazily on the first verification, serves every later one
 * from memory, and re-fetches only when a token arrives bearing a `kid` it has not seen —
 * which is exactly what key rotation looks like from here. The cooldown means a burst of
 * tokens with an unknown `kid` cannot be turned into a burst of outbound requests.
 */
export const SUPABASE_JWKS = Symbol('SUPABASE_JWKS');

/** Long, because the key set changes only when the project rotates its signing key. */
const CACHE_MAX_AGE_MS = 10 * 60 * 1000;

/** Floor between refetches, so an unknown `kid` cannot be used to hammer the endpoint. */
const COOLDOWN_MS = 30 * 1000;

export function supabaseIssuer(config: ConfigService): string {
  // A trailing slash in the env var would produce `//auth/v1` and fail every issuer check
  // with an error that reads like a signing problem.
  return `${config.getOrThrow<string>('SUPABASE_URL').replace(/\/+$/, '')}/auth/v1`;
}

export const supabaseJwksProvider: Provider = {
  provide: SUPABASE_JWKS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): JWTVerifyGetKey =>
    createRemoteJWKSet(new URL(`${supabaseIssuer(config)}/.well-known/jwks.json`), {
      cacheMaxAge: CACHE_MAX_AGE_MS,
      cooldownDuration: COOLDOWN_MS,
    }),
};
