import { BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
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
  resend: jest.Mock;
  getUser: jest.Mock;
  admin: { signOut: jest.Mock; deleteUser: jest.Mock; getUserById: jest.Mock };
  signInWithIdToken: jest.Mock;
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
      resend: jest.fn(),
      getUser: jest.fn(),
      admin: { signOut: jest.fn(), deleteUser: jest.fn(), getUserById: jest.fn() },
      signInWithIdToken: jest.fn(),
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

  // ADR-041. The phone gets an ID token from Google/Apple; the API exchanges it with Supabase,
  // which verifies it against the identity provider. No password ever passes through FORJD.
  describe('signInWithIdToken', () => {
    it('exchanges the ID token and returns the identity and session', async () => {
      auth.signInWithIdToken.mockResolvedValue({
        data: {
          user: { id: 'ext-9', email: 'g@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
          session: { access_token: 'a', refresh_token: 'r', expires_at: 1_800_000_000 },
        },
        error: null,
      });

      const result = await provider.signInWithIdToken({ provider: 'google', idToken: 'id-token', nonce: 'n' });

      expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'id-token', nonce: 'n' });
      expect(result.identity).toEqual({ externalId: 'ext-9', email: 'g@example.com', emailVerified: true });
      expect(result.session.accessToken).toBe('a');
    });

    it('omits the nonce when there is none', async () => {
      auth.signInWithIdToken.mockResolvedValue({
        data: {
          user: { id: 'ext-9', email: 'g@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
          session: { access_token: 'a', refresh_token: 'r', expires_at: 1_800_000_000 },
        },
        error: null,
      });

      await provider.signInWithIdToken({ provider: 'google', idToken: 'id-token' });

      expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'id-token' });
    });

    it('rejects a token the provider refuses with the same constant message as a bad password', async () => {
      auth.signInWithIdToken.mockResolvedValue({ data: { user: null, session: null }, error: authError('Invalid token') });

      await expect(provider.signInWithIdToken({ provider: 'apple', idToken: 'bad', nonce: 'n' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('deleteUser', () => {
    it('deletes the upstream user by external id', async () => {
      auth.admin.deleteUser.mockResolvedValue({ data: {}, error: null });

      await provider.deleteUser('ext-1');

      expect(auth.admin.deleteUser).toHaveBeenCalledWith('ext-1');
    });

    it('treats an already-deleted user as success so a retry can finish', async () => {
      auth.admin.deleteUser.mockResolvedValue({
        data: null,
        error: { message: 'User not found', status: 404, code: 'user_not_found' },
      });

      await expect(provider.deleteUser('ext-1')).resolves.toBeUndefined();
    });

    it('throws on any other failure so the caller does not report a finished deletion', async () => {
      auth.admin.deleteUser.mockResolvedValue({
        data: null,
        error: { message: 'boom', status: 500, code: 'unexpected_failure' },
      });

      await expect(provider.deleteUser('ext-1')).rejects.toThrow('boom');
    });
  });

  describe('userExists', () => {
    it('is true when Supabase still has the user', async () => {
      auth.admin.getUserById.mockResolvedValue({ data: { user: { id: 'ext-1' } }, error: null });

      await expect(provider.userExists('ext-1')).resolves.toBe(true);
      expect(auth.admin.getUserById).toHaveBeenCalledWith('ext-1');
    });

    it('is false for a deleted user', async () => {
      auth.admin.getUserById.mockResolvedValue({
        data: { user: null },
        error: { message: 'User not found', status: 404, code: 'user_not_found' },
      });

      await expect(provider.userExists('ext-1')).resolves.toBe(false);
    });

    it('throws on any other failure, so an outage is not read as a deleted account (or a live one)', async () => {
      auth.admin.getUserById.mockResolvedValue({
        data: { user: null },
        error: { message: 'boom', status: 500, code: 'unexpected_failure' },
      });

      await expect(provider.userExists('ext-1')).rejects.toThrow('boom');
    });
  });

  describe('resendConfirmation', () => {
    it('asks Supabase to resend the signup confirmation email', async () => {
      auth.resend.mockResolvedValue({ error: null });

      await provider.resendConfirmation('a@example.com');

      expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@example.com' });
    });

    it('resolves even when the provider reports an error, so an unknown address reads the same', async () => {
      auth.resend.mockResolvedValue({ error: authError('User not found', 'user_not_found') });

      await expect(provider.resendConfirmation('nobody@example.com')).resolves.toBeUndefined();
    });

    // Supabase answers "ok" even when it sends nothing (unknown or already-confirmed address,
    // a send inside its minimum gap), so the outcome is logged to make a silent non-send visible.
    // The address itself never goes in the log.
    it('logs that the provider accepted the request, without the address', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      auth.resend.mockResolvedValue({ error: null });

      await provider.resendConfirmation('a@example.com');

      expect(log).toHaveBeenCalledWith(expect.stringContaining('resendConfirmation accepted'));
      expect(JSON.stringify(log.mock.calls)).not.toContain('a@example.com');
      log.mockRestore();
    });

    it('logs the provider error code when it refuses, without the address', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      auth.resend.mockResolvedValue({
        error: authError('For security purposes, you can only request this after 59 seconds', 'over_email_send_rate_limit'),
      });

      await provider.resendConfirmation('a@example.com');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('over_email_send_rate_limit'));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('a@example.com');
      warn.mockRestore();
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
