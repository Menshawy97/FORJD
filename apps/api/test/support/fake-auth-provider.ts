import { UnauthorizedException } from '@nestjs/common';

import {
  AuthCredentials,
  AuthIdentity,
  AuthProvider,
  AuthResult,
  AuthSession,
  SignUpResult,
} from '../../src/auth/providers/auth-provider.interface';

export interface FakeAuthAccount {
  email: string;
  externalId: string;
  /** Access tokens that authenticate this account. The first is the "primary" token returned by signUp/signIn/session. */
  tokens: string[];
}

export interface FakeAuthRefreshConfig {
  /** Refresh token refreshSession must be called with. Omit to accept any value. */
  refreshToken?: string;
  /** Access token to switch to on a successful refresh. Omit to keep the account's primary token. */
  rotatedAccessToken?: string;
  /** Account whose session is returned on refresh. */
  targetEmail: string;
}

export interface FakeAuthProviderOptions {
  accounts: FakeAuthAccount[];
  /** 'password' (default) validates against the password passed to signUp. 'disabled' makes signIn always throw. */
  signIn?: 'password' | 'disabled';
  /** 'disabled' (default) makes refreshSession always throw. Otherwise refreshSession succeeds per the config. */
  refresh?: FakeAuthRefreshConfig | 'disabled';
  emailConfirmationRequired?: boolean;
}

/**
 * An in-memory stand-in for Supabase, shared by every e2e suite that overrides AUTH_PROVIDER
 * (ADR-008). Each suite configures only the accounts and behaviors it exercises; anything not
 * configured throws, matching how the individual per-suite fakes used to behave.
 */
export class FakeAuthProvider implements AuthProvider {
  emailConfirmationRequired: boolean;
  revokedTokens: string[] = [];
  resetRequests: string[] = [];

  private readonly passwords = new Map<string, string>();
  private readonly tokenOwners = new Map<string, string>();
  private readonly primaryTokens = new Map<string, string>();
  private readonly externalIds = new Map<string, string>();
  private readonly signInMode: 'password' | 'disabled';
  private readonly refreshConfig: FakeAuthRefreshConfig | 'disabled';

  constructor(options: FakeAuthProviderOptions) {
    this.emailConfirmationRequired = options.emailConfirmationRequired ?? false;
    this.signInMode = options.signIn ?? 'password';
    this.refreshConfig = options.refresh ?? 'disabled';

    for (const account of options.accounts) {
      const [primaryToken] = account.tokens;
      if (!primaryToken) {
        throw new Error(`FakeAuthProvider account ${account.email} needs at least one token`);
      }
      this.primaryTokens.set(account.email, primaryToken);
      this.externalIds.set(account.email, account.externalId);
      for (const token of account.tokens) {
        this.tokenOwners.set(token, account.email);
      }
    }
  }

  async signUp(credentials: AuthCredentials): Promise<SignUpResult> {
    this.passwords.set(credentials.email, credentials.password);

    return {
      identity: this.identity(credentials.email),
      session: this.emailConfirmationRequired ? null : this.session(credentials.email),
    };
  }

  async signIn(credentials: AuthCredentials): Promise<AuthResult> {
    if (this.signInMode === 'disabled') {
      throw new UnauthorizedException('Not used in this suite');
    }

    if (this.passwords.get(credentials.email) !== credentials.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      identity: this.identity(credentials.email),
      session: this.session(credentials.email),
    };
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    if (this.refreshConfig === 'disabled') {
      throw new UnauthorizedException('Not used in this suite');
    }

    const { refreshToken: expected, rotatedAccessToken, targetEmail } = this.refreshConfig;

    if (expected !== undefined && refreshToken !== expected) {
      throw new UnauthorizedException('Could not refresh session');
    }

    const session = this.session(targetEmail);

    return rotatedAccessToken ? { ...session, accessToken: rotatedAccessToken } : session;
  }

  async signOut(accessToken: string): Promise<void> {
    this.revokedTokens.push(accessToken);
  }

  /**
   * Records the attempt and resolves unconditionally, mirroring the real adapter: an unknown
   * address must be indistinguishable from a known one.
   */
  async requestPasswordReset(email: string): Promise<void> {
    this.resetRequests.push(email);
  }

  async verifyAccessToken(accessToken: string): Promise<AuthIdentity> {
    const email = this.tokenOwners.get(accessToken);

    if (!email) {
      throw new UnauthorizedException('Invalid access token');
    }

    return this.identity(email);
  }

  private session(email: string): AuthSession {
    return {
      accessToken: this.primaryTokens.get(email)!,
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-06-01T12:00:00Z'),
    };
  }

  private identity(email: string): AuthIdentity {
    return {
      externalId: this.externalIds.get(email)!,
      email,
      emailVerified: !this.emailConfirmationRequired,
    };
  }
}
