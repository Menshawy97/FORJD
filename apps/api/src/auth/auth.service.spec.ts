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
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'upsertFromIdentity' | 'recordAudit'>>;
  let service: AuthService;

  beforeEach(() => {
    authProvider = {
      signUp: jest.fn(),
      signIn: jest.fn(),
      refreshSession: jest.fn(),
      signOut: jest.fn(),
      verifyAccessToken: jest.fn(),
    };
    usersRepository = {
      upsertFromIdentity: jest.fn().mockResolvedValue(user),
      recordAudit: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(authProvider, usersRepository as unknown as UsersRepository);
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

  it('logout revokes the token before recording the audit entry', async () => {
    authProvider.signOut.mockResolvedValue(undefined);

    await service.logout('access-1', 'user-1');

    expect(authProvider.signOut).toHaveBeenCalledWith('access-1');
    expect(usersRepository.recordAudit).toHaveBeenCalledWith('user-1', 'auth.logout');
  });
});
