import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';

import {
  AuthCredentials,
  AuthIdentity,
  AuthProvider,
  AuthResult,
  AuthSession,
  SignUpResult,
} from './auth-provider.interface';

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
  private readonly client: SupabaseClient;

  constructor(config: ConfigService) {
    this.client = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  async signUp(credentials: AuthCredentials): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp(credentials);

    if (error || !data.user) {
      throw new UnauthorizedException(error?.message ?? 'Registration failed');
    }

    return {
      identity: this.toIdentity(data.user),
      session: data.session ? this.toSession(data.session) : null,
    };
  }

  async signIn(credentials: AuthCredentials): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signInWithPassword(credentials);

    if (error || !data.user || !data.session) {
      throw new UnauthorizedException(error?.message ?? 'Invalid credentials');
    }

    return { identity: this.toIdentity(data.user), session: this.toSession(data.session) };
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session) {
      throw new UnauthorizedException(error?.message ?? 'Could not refresh session');
    }

    return this.toSession(data.session);
  }

  async signOut(accessToken: string): Promise<void> {
    // Revokes the refresh token server-side, so a stolen token cannot be renewed.
    const { error } = await this.client.auth.admin.signOut(accessToken);

    if (error) {
      throw new UnauthorizedException(error.message);
    }
  }

  async verifyAccessToken(accessToken: string): Promise<AuthIdentity> {
    const { data, error } = await this.client.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new UnauthorizedException(error?.message ?? 'Invalid access token');
    }

    return this.toIdentity(data.user);
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
