import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { User } from '@forjd/domain';

import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';
import { AuthProvider, AuthSession } from './providers/auth-provider.interface';

const user: User = {
  id: 'user-1',
  email: 'a@example.com',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const session: AuthSession = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: new Date('2026-01-01T01:00:00Z'),
};

const identity = { externalId: 'ext-1', email: 'a@example.com', emailVerified: true };

describe('AuthService', () => {
  let authProvider: jest.Mocked<AuthProvider>;
  let usersRepository: jest.Mocked<
    Pick<UsersRepository, 'upsertFromIdentity' | 'recordAudit' | 'updateProfile' | 'findByExternalId'>
  >;
  let service: AuthService;

  beforeEach(() => {
    authProvider = {
      signUp: jest.fn(),
      signIn: jest.fn(),
      refreshSession: jest.fn(),
      signOut: jest.fn(),
      requestPasswordReset: jest.fn(),
      verifyAccessToken: jest.fn(),
      deleteUser: jest.fn(),
      signInWithIdToken: jest.fn(),
    };
    usersRepository = {
      upsertFromIdentity: jest.fn().mockResolvedValue(user),
      recordAudit: jest.fn().mockResolvedValue(undefined),
      updateProfile: jest.fn().mockResolvedValue(null),
      findByExternalId: jest.fn().mockResolvedValue(user),
    };
    service = new AuthService(authProvider, usersRepository as unknown as UsersRepository);
  });

  // ADR-041. Google/Apple sign-in: the same session shape as a password login, plus whether
  // this was the account's first sight of FORJD. The date-of-birth step follows for new
  // accounts (ADR-042), enforced by the guard rather than trusted to this flag.
  describe('socialSignIn', () => {
    const request = { provider: 'google' as const, idToken: 'id-token-id-token-id-token' };

    it('returns the session and marks a first sign-in as new', async () => {
      authProvider.signInWithIdToken.mockResolvedValue({ identity, session });
      usersRepository.findByExternalId.mockResolvedValue(null);

      const result = await service.socialSignIn(request);

      expect(result).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2026-01-01T01:00:00.000Z',
        isNewUser: true,
      });
    });

    it('marks a returning account as not new', async () => {
      authProvider.signInWithIdToken.mockResolvedValue({ identity, session });
      usersRepository.findByExternalId.mockResolvedValue(user);

      await expect(service.socialSignIn(request)).resolves.toMatchObject({ isNewUser: false });
    });

    it('creates the local user, profile and privacy rows through the same path as every login', async () => {
      authProvider.signInWithIdToken.mockResolvedValue({ identity, session });

      await service.socialSignIn(request);

      expect(usersRepository.upsertFromIdentity).toHaveBeenCalledWith(identity.externalId, identity.email);
    });

    it('passes the nonce through to the provider when there is one', async () => {
      authProvider.signInWithIdToken.mockResolvedValue({ identity, session });

      await service.socialSignIn({ provider: 'apple', idToken: 'id-token-id-token-id-token', nonce: 'raw-nonce-1' });

      expect(authProvider.signInWithIdToken).toHaveBeenCalledWith({
        provider: 'apple',
        idToken: 'id-token-id-token-id-token',
        nonce: 'raw-nonce-1',
      });
    });

    it('records which provider was used and whether the account is new, and nothing else', async () => {
      authProvider.signInWithIdToken.mockResolvedValue({ identity, session });
      usersRepository.findByExternalId.mockResolvedValue(null);

      await service.socialSignIn(request);

      expect(usersRepository.recordAudit).toHaveBeenCalledWith('user-1', 'auth.social_sign_in', {
        provider: 'google',
        isNewUser: true,
      });
    });

    // Security review of 8F: linking to an existing email account is only safe if the provider
    // vouches for the address. An unverified address must never yield a session.
    it('refuses, and revokes the session it just got, when the provider does not vouch for the email', async () => {
      authProvider.signInWithIdToken.mockResolvedValue({ identity: { ...identity, emailVerified: false }, session });
      authProvider.signOut.mockResolvedValue(undefined);

      await expect(service.socialSignIn(request)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(authProvider.signOut).toHaveBeenCalledWith(session.accessToken);
      expect(usersRepository.upsertFromIdentity).not.toHaveBeenCalled();
    });

    // An address already held by a different local account: the provider has issued a session by
    // now, so it must be revoked, and the caller gets the same constant 401 as any bad token
    // (a 409 would confirm the address is registered).
    it('revokes the session and answers a constant 401 when the address belongs to a different account', async () => {
      authProvider.signInWithIdToken.mockResolvedValue({ identity, session });
      authProvider.signOut.mockResolvedValue(undefined);
      usersRepository.upsertFromIdentity.mockRejectedValue(new ConflictException('different account'));

      await expect(service.socialSignIn(request)).rejects.toThrow(new UnauthorizedException('Invalid credentials'));

      expect(authProvider.signOut).toHaveBeenCalledWith(session.accessToken);
    });

    it('does not disguise an unexpected database failure as a bad token, and does not revoke the session', async () => {
      authProvider.signInWithIdToken.mockResolvedValue({ identity, session });
      usersRepository.upsertFromIdentity.mockRejectedValue(new Error('connection refused'));

      await expect(service.socialSignIn(request)).rejects.toThrow('connection refused');

      expect(authProvider.signOut).not.toHaveBeenCalled();
    });

    it('propagates a rejected token without touching the database', async () => {
      authProvider.signInWithIdToken.mockRejectedValue(new Error('invalid'));

      await expect(service.socialSignIn(request)).rejects.toThrow('invalid');

      expect(usersRepository.upsertFromIdentity).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('returns a null session when the provider requires email confirmation', async () => {
      authProvider.signUp.mockResolvedValue({
        identity: { ...identity, emailVerified: false },
        session: null,
      });

      const result = await service.register({ email: 'a@example.com', password: 'password123' });

      expect(result).toEqual({
        userId: 'user-1',
        email: 'a@example.com',
        emailVerified: false,
        session: null,
      });
    });

    it('serialises the session when one is issued immediately', async () => {
      authProvider.signUp.mockResolvedValue({ identity, session });

      const result = await service.register({ email: 'a@example.com', password: 'password123' });

      expect(result.session).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2026-01-01T01:00:00.000Z',
      });
    });

    it('records an audit entry against the internal user id', async () => {
      authProvider.signUp.mockResolvedValue({ identity, session });

      await service.register({ email: 'a@example.com', password: 'password123' });

      expect(usersRepository.recordAudit).toHaveBeenCalledWith('user-1', 'auth.register', {
        emailVerified: true,
      });
    });

    it('writes a supplied display name to the profile', async () => {
      authProvider.signUp.mockResolvedValue({ identity, session });

      await service.register({
        email: 'a@example.com',
        password: 'password123',
        displayName: 'Ada Lovelace',
      });

      expect(usersRepository.updateProfile).toHaveBeenCalledWith('user-1', {
        displayName: 'Ada Lovelace',
      });
    });

    it('leaves the profile untouched when no display name is supplied', async () => {
      authProvider.signUp.mockResolvedValue({ identity, session });

      await service.register({ email: 'a@example.com', password: 'password123' });

      expect(usersRepository.updateProfile).not.toHaveBeenCalled();
    });

    it('returns the unchanged response shape when a display name is supplied', async () => {
      authProvider.signUp.mockResolvedValue({ identity, session });

      const result = await service.register({
        email: 'a@example.com',
        password: 'password123',
        displayName: 'Ada Lovelace',
      });

      expect(result).toEqual({
        userId: 'user-1',
        email: 'a@example.com',
        emailVerified: true,
        session: {
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: '2026-01-01T01:00:00.000Z',
        },
      });
    });
  });

  describe('login', () => {
    it('links the external identity and returns the session', async () => {
      authProvider.signIn.mockResolvedValue({ identity, session });

      const result = await service.login({ email: 'a@example.com', password: 'password123' });

      expect(usersRepository.upsertFromIdentity).toHaveBeenCalledWith('ext-1', 'a@example.com');
      expect(result.accessToken).toBe('access-1');
      expect(usersRepository.recordAudit).toHaveBeenCalledWith('user-1', 'auth.login');
    });

    it('propagates a provider rejection rather than inventing a session', async () => {
      authProvider.signIn.mockRejectedValue(new Error('Invalid credentials'));

      await expect(service.login({ email: 'a@example.com', password: 'wrong' })).rejects.toThrow(
        'Invalid credentials',
      );
      expect(usersRepository.recordAudit).not.toHaveBeenCalled();
    });
  });

  it('refresh delegates to the provider and serialises the new session', async () => {
    authProvider.refreshSession.mockResolvedValue(session);

    const result = await service.refresh('refresh-1');

    expect(authProvider.refreshSession).toHaveBeenCalledWith('refresh-1');
    expect(result.expiresAt).toBe('2026-01-01T01:00:00.000Z');
  });

  describe('requestPasswordReset', () => {
    it('delegates to the provider and audits without resolving a user', async () => {
      authProvider.requestPasswordReset.mockResolvedValue(undefined);

      await service.requestPasswordReset('a@example.com');

      expect(authProvider.requestPasswordReset).toHaveBeenCalledWith('a@example.com');
      expect(usersRepository.recordAudit).toHaveBeenCalledWith(
        null,
        'auth.password_reset_requested',
        { email: 'a@example.com' },
      );
      expect(usersRepository.upsertFromIdentity).not.toHaveBeenCalled();
    });

    it('resolves for an address with no account, so callers cannot tell the difference', async () => {
      authProvider.requestPasswordReset.mockResolvedValue(undefined);

      await expect(service.requestPasswordReset('nobody@example.com')).resolves.toBeUndefined();
    });
  });

  it('logout revokes the token before recording the audit entry', async () => {
    authProvider.signOut.mockResolvedValue(undefined);

    await service.logout('access-1', 'user-1');

    expect(authProvider.signOut).toHaveBeenCalledWith('access-1');
    expect(usersRepository.recordAudit).toHaveBeenCalledWith('user-1', 'auth.logout');
  });
});
