import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthError, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import { JWTVerifyGetKey, jwtVerify } from 'jose';

import { SUPABASE_AUTH_CLIENT } from './supabase-auth-client';
import { SUPABASE_JWKS, supabaseIssuer } from './supabase-jwks';
import {
  AuthCredentials,
  AuthIdentity,
  AuthProvider,
  AuthResult,
  AuthSession,
  SignUpResult,
} from './auth-provider.interface';

/**
 * GoTrue reports a policy rejection as `weak_password`. The message check is a fallback for
 * older responses that carry no code — matching on the message alone would be fragile, but
 * as a second condition it costs nothing and the failure mode is only that a weak-password
 * error stays generic, which is what happens today anyway.
 */
function isWeakPasswordError(error: AuthError): boolean {
  return error.code === 'weak_password' || error.message.startsWith('Password should');
}

/**
 * GoTrue throttles outbound mail per project, not per address, so this fires on a signup for
 * an address that has never been seen. Same belt-and-braces shape as `isWeakPasswordError`:
 * the code is the real signal, the message match is the backstop for when it is absent.
 */
function isMailRateLimitError(error: AuthError): boolean {
  return (
    error.code === 'over_email_send_rate_limit' ||
    error.message.toLowerCase().includes('email rate limit exceeded')
  );
}

/**
 * Supabase issues every signed-in user's token with this audience. Anything else was minted
 * for a different consumer and must not authenticate a request here.
 */
const ACCESS_TOKEN_AUDIENCE = 'authenticated';

/**
 * Asymmetric only, and pinned rather than read from the token's own header. The header is
 * attacker-controlled: a verifier that honours it will accept an HS256 token signed with
 * the public key, which is public. Listing both curves keeps a future RS256 rotation from
 * being an outage.
 */
const ACCESS_TOKEN_ALGORITHMS = ['ES256', 'RS256'];

interface SupabaseSessionShape {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

/** The subset of a Supabase access token's claims this adapter reads. */
interface JwtClaims {
  sub?: string;
  email?: string;
  user_metadata?: { email_verified?: boolean };
}

/**
 * The only place in the API allowed to speak Supabase for authentication (ADR-008).
 * Everything it returns is provider-neutral, so nothing downstream knows the vendor.
 */
@Injectable()
export class SupabaseAuthProvider implements AuthProvider {
  private readonly logger = new Logger(SupabaseAuthProvider.name);
  private readonly passwordResetRedirectUrl: string | undefined;

  private readonly issuer: string;

  constructor(
    @Inject(SUPABASE_AUTH_CLIENT) private readonly client: SupabaseClient,
    config: ConfigService,
    @Inject(SUPABASE_JWKS) private readonly jwks: JWTVerifyGetKey,
  ) {
    this.issuer = supabaseIssuer(config);
    // `get`, not `getOrThrow`: CI supplies only the two required Supabase vars, and an
    // unset redirect simply falls back to the project's Site URL.
    this.passwordResetRedirectUrl = config.get<string>('AUTH_PASSWORD_RESET_REDIRECT_URL');
  }

  async signUp(credentials: AuthCredentials): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp(credentials);

    if (error || !data.user) {
      // A rejected password is the one signUp failure worth forwarding. It reveals nothing
      // about whether the address already has an account, so withholding it protects
      // nobody — it just leaves someone stuck at a form with no idea what is wrong.
      // `registerRequestSchema` mirrors the provider's policy, so this should normally be
      // unreachable; it stays as the backstop for when the two drift apart.
      if (error && isWeakPasswordError(error)) {
        this.logger.warn(`signUp rejected a weak password: ${error.message}`);

        // Deliberately not the provider's own message. GoTrue's text lists its entire
        // symbol alphabet and rendered as four dense lines on the signup screen. The full
        // text stays in the log; the caller gets the same rule in the same words the
        // contract uses, so the two can never contradict each other.
        throw new BadRequestException(
          'Password must be at least 8 characters and include an uppercase letter, ' +
            'a lowercase letter, a number, and a symbol.',
        );
      }

      // Safe to forward for the same reason the weak-password branch above is: GoTrue counts
      // this against the project's mail quota, not against the address, so it fires
      // identically for a brand-new address and one that already has an account. Collapsing it into the
      // generic failure protects nobody and tells the user to "try again" when retrying
      // cannot succeed until the quota refills. Found on the slice 14 device walk.
      if (error && isMailRateLimitError(error)) {
        this.logger.warn(`signUp hit the provider mail rate limit: ${error.message}`);

        throw new HttpException(
          'Too many sign-up emails have been sent recently. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      this.reject('signUp', error?.message);
    }

    return {
      identity: this.toIdentity(data.user),
      session: data.session ? this.toSession(data.session) : null,
    };
  }

  async signIn(credentials: AuthCredentials): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signInWithPassword(credentials);

    if (error || !data.user || !data.session) {
      this.reject('signIn', error?.message);
    }

    return { identity: this.toIdentity(data.user), session: this.toSession(data.session) };
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session) {
      this.reject('refreshSession', error?.message);
    }

    return this.toSession(data.session);
  }

  async signOut(accessToken: string): Promise<void> {
    // Revokes the refresh token server-side, so a stolen token cannot be renewed.
    const { error } = await this.client.auth.admin.signOut(accessToken);

    if (error) {
      this.reject('signOut', error.message);
    }
  }

  /**
   * Deliberately does not go through `reject()`. GoTrue reports "user not found" and its own
   * per-address rate-limit errors here; turning either into a non-2xx would tell a caller
   * which addresses hold accounts. The detail stays in the log, the caller always sees the
   * same thing, and a genuine outage surfaces through monitoring rather than through the
   * one response an attacker can read.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(
      email,
      this.passwordResetRedirectUrl ? { redirectTo: this.passwordResetRedirectUrl } : undefined,
    );

    if (error) {
      this.logger.warn(`requestPasswordReset failed: ${error.message}`);
    }
  }

  /**
   * Verified in process against the project's published signing keys, not by asking
   * Supabase (ADR-012). This runs on every authenticated request, so the network round trip
   * it replaces was the largest fixed cost in the API.
   *
   * The tradeoff is written down rather than hidden: a token stays valid until it expires,
   * so signing out revokes the refresh token but cannot recall an access token already
   * issued. The access-token lifetime is therefore the revocation window, which is why
   * ADR-012 pins it short.
   */
  async verifyAccessToken(accessToken: string): Promise<AuthIdentity> {
    let claims: JwtClaims;

    try {
      const { payload } = await jwtVerify(accessToken, this.jwks, {
        issuer: this.issuer,
        audience: ACCESS_TOKEN_AUDIENCE,
        algorithms: ACCESS_TOKEN_ALGORITHMS,
      });

      claims = payload as JwtClaims;
    } catch (error: unknown) {
      // Every failure reads the same to the caller. An expired token and a forged one are
      // both just "not authenticated"; saying which would tell an attacker whether a
      // signature was the part that failed.
      this.reject('verifyAccessToken', error instanceof Error ? error.message : undefined);
    }

    if (!claims.sub) {
      this.reject('verifyAccessToken', 'token carried no subject');
    }

    return {
      externalId: claims.sub,
      email: claims.email ?? '',
      // Absent means unverified. Defaulting the other way would let a token minted before
      // this claim existed read as confirmed.
      emailVerified: claims.user_metadata?.email_verified === true,
    };
  }

  /**
   * GoTrue distinguishes "User already registered" from a clean signup, and "Invalid login
   * credentials" from "Email not confirmed". Forwarding those strings lets a caller probe
   * which addresses hold accounts — on a product where the account is attached to health
   * data. The detail stays in the server log; the caller gets a constant message.
   */
  private reject(context: string, detail: string | undefined): never {
    this.logger.warn(`${context} failed: ${detail ?? 'no detail from provider'}`);

    throw new UnauthorizedException(
      context === 'signUp' ? 'Registration failed' : 'Invalid credentials',
    );
  }

  private toIdentity(user: SupabaseUser): AuthIdentity {
    return {
      externalId: user.id,
      email: user.email ?? '',
      emailVerified: Boolean(user.email_confirmed_at),
    };
  }

  private toSession(session: SupabaseSessionShape): AuthSession {
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : new Date(Date.now() + 3_600_000),
    };
  }
}
