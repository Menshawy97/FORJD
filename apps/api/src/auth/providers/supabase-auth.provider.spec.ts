import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthError } from '@supabase/supabase-js';

import { SupabaseAuthProvider } from './supabase-auth.provider';

/**
 * These three behaviours were previously verified by hand against the live project and by
 * no test at all, because the provider built its own client in the constructor and offered
 * nothing to stub (see ADR-011 and the roadmap's slice 11 follow-ups). The injected client
 * is what makes them reachable.
 */

/** Enough of GoTrue's error shape for `reject()` and `isWeakPasswordError` to branch on. */
function authError(message: string, code?: string): AuthError {
  return { name: 'AuthApiError', message, code, status: 400 } as AuthError;
}

const supabaseUser = {
  id: 'ext-1',
  email: 'a@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
};

interface AuthStub {
  signUp: jest.Mock;
  signInWithPassword: jest.Mock;
  refreshSession: jest.Mock;
  resetPasswordForEmail: jest.Mock;
  getUser: jest.Mock;
  admin: { signOut: jest.Mock };
}

describe('SupabaseAuthProvider', () => {
  let auth: AuthStub;
  let provider: SupabaseAuthProvider;

  beforeEach(() => {
    auth = {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      refreshSession: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      getUser: jest.fn(),
      admin: { signOut: jest.fn() },
    };

    provider = new SupabaseAuthProvider(
      { auth } as never,
      {
        get: jest.fn().mockReturnValue(undefined),
        getOrThrow: jest.fn().mockReturnValue('https://project.supabase.co'),
      } as never,
      // Token verification has its own suite (supabase-jwt.spec.ts). Nothing here reaches
      // the key set, so a resolver that would throw is the honest stub.
      (() => {
        throw new Error('the key set must not be consulted by these tests');
      }) as never,
    );
  });

  describe('signUp', () => {
    it('forwards a rejected password as a 400 naming the rule', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError('Password should contain at least one of...', 'weak_password'),
      });

      await expect(
        provider.signUp({ email: 'a@example.com', password: 'weak' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the contract wording rather than the provider message', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError('Password should contain at least one of...', 'weak_password'),
      });

      await expect(provider.signUp({ email: 'a@example.com', password: 'weak' })).rejects.toThrow(
        /at least 8 characters and include an uppercase letter/,
      );
    });

    it('recognises a weak password from the message when no code is present', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError('Password should be at least 8 characters'),
      });

      await expect(
        provider.signUp({ email: 'a@example.com', password: 'weak' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    /**
     * Found during the slice 14 device walk: signup started failing with the generic
     * "Please try again", which invites an immediate retry that cannot succeed for an hour.
     * Unlike "User already registered", a mail-send rate limit says nothing about whether an
     * address holds an account — it is keyed on the project's mail quota, not the address —
     * so forwarding it leaks nothing and is the difference between a user retrying uselessly
     * and knowing to wait.
     */
    it('forwards a mail rate limit as a 429 telling the caller to wait', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError('email rate limit exceeded', 'over_email_send_rate_limit'),
      });

      await expect(
        provider.signUp({ email: 'a@example.com', password: 'Str0ng!Pass1' }),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('recognises a mail rate limit from the message when no code is present', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError('email rate limit exceeded'),
      });

      await expect(
        provider.signUp({ email: 'a@example.com', password: 'Str0ng!Pass1' }),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('does not name the address or its account status in the rate-limit message', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError('email rate limit exceeded', 'over_email_send_rate_limit'),
      });

      await expect(
        provider.signUp({ email: 'a@example.com', password: 'Str0ng!Pass1' }),
      ).rejects.not.toThrow(/a@example\.com|registered|exists/);
    });

    it('collapses an already-registered address into the generic failure', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError('User already registered', 'user_already_exists'),
      });

      // The whole point: the caller must not be able to tell this apart from any other
      // signUp failure, or the endpoint becomes an account-enumeration oracle.
      await expect(
        provider.signUp({ email: 'a@example.com', password: 'Str0ng!Pass1' }),
      ).rejects.toThrow(new UnauthorizedException('Registration failed'));
    });

    it('returns a null session when the project requires email confirmation', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: { ...supabaseUser, email_confirmed_at: null }, session: null },
        error: null,
      });

      const result = await provider.signUp({
        email: 'a@example.com',
        password: 'Str0ng!Pass1',
      });

      expect(result).toEqual({
        identity: { externalId: 'ext-1', email: 'a@example.com', emailVerified: false },
        session: null,
      });
    });
  });

  describe('signIn', () => {
    it('reports every failure as the same invalid-credentials message', async () => {
      auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: authError('Email not confirmed', 'email_not_confirmed'),
      });

      await expect(
        provider.signIn({ email: 'a@example.com', password: 'Str0ng!Pass1' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });
  });

  describe('requestPasswordReset', () => {
    it('resolves even when the provider reports the address is unknown', async () => {
      auth.resetPasswordForEmail.mockResolvedValue({
        error: authError('User not found', 'user_not_found'),
      });

      // Resolving is the contract: a thrown error here would be a status-code difference
      // between a known and an unknown address.
      await expect(provider.requestPasswordReset('nobody@example.com')).resolves.toBeUndefined();
    });

    it('omits redirectTo when no redirect URL is configured', async () => {
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });

      await provider.requestPasswordReset('a@example.com');

      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', undefined);
    });
  });
});
