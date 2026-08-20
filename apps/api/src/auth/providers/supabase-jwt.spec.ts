import { UnauthorizedException } from '@nestjs/common';
import {
  exportJWK,
  generateKeyPair,
  JWTVerifyGetKey,
  KeyLike,
  SignJWT,
  createLocalJWKSet,
} from 'jose';

import { SupabaseAuthProvider } from './supabase-auth.provider';

/**
 * Verification moved off the network, so these tests are the whole safety net. They sign
 * real tokens with a throwaway key rather than asserting against a mocked verifier: a test
 * that mocks the thing under test would pass just as happily against a verifier that
 * accepted `alg: none`.
 */

const ISSUER = 'https://project.supabase.co/auth/v1';
const AUDIENCE = 'authenticated';

interface Keys {
  privateKey: KeyLike;
  publicJwk: Record<string, unknown>;
  jwks: JWTVerifyGetKey;
  kid: string;
}

async function makeKeys(kid: string): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };

  return {
    privateKey,
    publicJwk,
    jwks: createLocalJWKSet({ keys: [publicJwk] }) as JWTVerifyGetKey,
    kid,
  };
}

function sign(keys: Keys, claims: Record<string, unknown> = {}, expires = '1h'): Promise<string> {
  return new SignJWT({ email: 'a@example.com', user_metadata: { email_verified: true }, ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: keys.kid })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject('ext-1')
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(keys.privateKey);
}

function providerWith(jwks: JWTVerifyGetKey): SupabaseAuthProvider {
  const config = {
    get: jest.fn().mockReturnValue(undefined),
    getOrThrow: jest.fn().mockReturnValue('https://project.supabase.co'),
  };

  return new SupabaseAuthProvider({ auth: {} } as never, config as never, jwks);
}

describe('SupabaseAuthProvider.verifyAccessToken', () => {
  let keys: Keys;
  let provider: SupabaseAuthProvider;

  beforeEach(async () => {
    keys = await makeKeys('key-1');
    provider = providerWith(keys.jwks);
  });

  it('accepts a correctly signed token and maps it to a provider-neutral identity', async () => {
    const identity = await provider.verifyAccessToken(await sign(keys));

    expect(identity).toEqual({
      externalId: 'ext-1',
      email: 'a@example.com',
      emailVerified: true,
    });
  });

  it('rejects an expired token', async () => {
    const expired = await sign(keys, {}, '-1s');

    await expect(provider.verifyAccessToken(expired)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose payload was tampered with after signing', async () => {
    const [header, , signature] = (await sign(keys)).split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'someone-else', iss: ISSUER, aud: AUDIENCE, exp: 9_999_999_999 }),
    ).toString('base64url');

    await expect(
      provider.verifyAccessToken(`${header}.${forged}.${signature}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed by a different key', async () => {
    const attacker = await makeKeys('key-1');

    // Same `kid`, so the resolver finds a key; only the signature check can catch this.
    await expect(provider.verifyAccessToken(await sign(attacker))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token from another issuer', async () => {
    const foreign = await new SignJWT({ email: 'a@example.com' })
      .setProtectedHeader({ alg: 'ES256', kid: keys.kid })
      .setIssuer('https://attacker.example.com/auth/v1')
      .setAudience(AUDIENCE)
      .setSubject('ext-1')
      .setExpirationTime('1h')
      .sign(keys.privateKey);

    await expect(provider.verifyAccessToken(foreign)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token for another audience', async () => {
    const wrongAudience = await new SignJWT({ email: 'a@example.com' })
      .setProtectedHeader({ alg: 'ES256', kid: keys.kid })
      .setIssuer(ISSUER)
      .setAudience('some-other-service')
      .setSubject('ext-1')
      .setExpirationTime('1h')
      .sign(keys.privateKey);

    await expect(provider.verifyAccessToken(wrongAudience)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an unsigned token claiming alg: none', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'ext-1', iss: ISSUER, aud: AUDIENCE, exp: 9_999_999_999 }),
    ).toString('base64url');

    await expect(provider.verifyAccessToken(`${header}.${payload}.`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an HS256 token signed with the public key as the shared secret', async () => {
    // The classic algorithm-confusion attack: the public key is public, so if the verifier
    // will honour the header's `alg`, anyone can mint a valid-looking token.
    const secret = new TextEncoder().encode(JSON.stringify(keys.publicJwk));
    const confused = await new SignJWT({ email: 'attacker@example.com' })
      .setProtectedHeader({ alg: 'HS256', kid: keys.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('ext-1')
      .setExpirationTime('1h')
      .sign(secret);

    await expect(provider.verifyAccessToken(confused)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('treats a missing email_verified claim as unverified rather than throwing', async () => {
    const identity = await provider.verifyAccessToken(
      await sign(keys, { user_metadata: undefined }),
    );

    expect(identity.emailVerified).toBe(false);
  });

  it('makes no network call to verify — the key resolver is consulted instead', async () => {
    const resolver = jest.fn(keys.jwks) as unknown as JWTVerifyGetKey;
    const local = providerWith(resolver);

    await local.verifyAccessToken(await sign(keys));
    await local.verifyAccessToken(await sign(keys));
    await local.verifyAccessToken(await sign(keys));

    // Three verifications, three resolver consultations, zero HTTP requests. The remote
    // JWKS set does its own caching behind this same interface in production.
    expect(resolver).toHaveBeenCalledTimes(3);
  });
});
