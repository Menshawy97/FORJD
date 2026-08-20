import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthError, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';

import { SUPABASE_AUTH_CLIENT } from './supabase-auth-client';
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

interface SupabaseSessionShape {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

/**
 * The only place in the API allowed to speak Supabase for authentication (ADR-008).
 * Everything it returns is provider-neutral, so nothing downstream knows the vendor.
 */
@Injectable()
export class SupabaseAuthProvider implements AuthProvider {
  private readonly logger = new Logger(SupabaseAuthProvider.name);
  private readonly passwordResetRedirectUrl: string | undefined;

  constructor(
    @Inject(SUPABASE_AUTH_CLIENT) private readonly client: SupabaseClient,
    config: ConfigService,
  ) {
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

  async verifyAccessToken(accessToken: string): Promise<AuthIdentity> {
    const { data, error } = await this.client.auth.getUser(accessToken);

    if (error || !data.user) {
      this.reject('verifyAccessToken', error?.message);
    }

    return this.toIdentity(data.user);
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
