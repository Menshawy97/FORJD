import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '@forjd/domain';

import { UsersRepository } from '../../users/users.repository';
import { AuthIdentity, AuthProvider } from '../providers/auth-provider.interface';
import { AllowWithoutDateOfBirth } from './allow-without-date-of-birth.decorator';
import { IdentityCache } from './identity-cache';
import { JwtAuthGuard } from './jwt-auth.guard';

class PlainController {
  handler(): void {}
}
class OpenController {
  @AllowWithoutDateOfBirth()
  handler(): void {}
}

const internalUser: User = {
  id: 'user-1',
  email: 'a@example.com',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function contextWith(authorization?: string, open = false): ExecutionContext {
  const request: { headers: Record<string, string | undefined>; user?: User } = {
    headers: { authorization },
  };
  const Controller = open ? OpenController : PlainController;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => Controller.prototype.handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let authProvider: jest.Mocked<Pick<AuthProvider, 'verifyAccessToken'>>;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'upsertFromIdentity' | 'hasDateOfBirth'>>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    authProvider = { verifyAccessToken: jest.fn() };
    usersRepository = { upsertFromIdentity: jest.fn(), hasDateOfBirth: jest.fn().mockResolvedValue(true) };
    guard = new JwtAuthGuard(
      authProvider as unknown as AuthProvider,
      usersRepository as unknown as UsersRepository,
      new IdentityCache(),
      new Reflector(),
    );
  });

  it('rejects a request with no Authorization header', async () => {
    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authProvider.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a non-bearer scheme without calling the provider', async () => {
    await expect(guard.canActivate(contextWith('Basic abc123'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authProvider.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects when the provider says the token is invalid', async () => {
    authProvider.verifyAccessToken.mockRejectedValue(new UnauthorizedException('bad token'));

    await expect(guard.canActivate(contextWith('Bearer nope'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resolves the internal user by external id and attaches it to the request', async () => {
    const identity: AuthIdentity = {
      externalId: 'ext-1',
      email: 'a@example.com',
      emailVerified: true,
    };
    authProvider.verifyAccessToken.mockResolvedValue(identity);
    usersRepository.upsertFromIdentity.mockResolvedValue(internalUser);

    const context = contextWith('Bearer good-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authProvider.verifyAccessToken).toHaveBeenCalledWith('good-token');
    expect(usersRepository.upsertFromIdentity).toHaveBeenCalledWith('ext-1', 'a@example.com');
    expect(context.switchToHttp().getRequest<{ user: User }>().user).toEqual(internalUser);
  });

  it('attaches the verified identity too, so a handler can act on the login even if the local row is gone', async () => {
    const identity: AuthIdentity = { externalId: 'ext-1', email: 'a@example.com', emailVerified: true };
    authProvider.verifyAccessToken.mockResolvedValue(identity);
    usersRepository.upsertFromIdentity.mockResolvedValue(internalUser);

    const context = contextWith('Bearer good-token');
    await guard.canActivate(context);

    expect(context.switchToHttp().getRequest<{ identity: AuthIdentity }>().identity).toEqual(identity);
  });

  it('accepts a lowercase bearer scheme', async () => {
    authProvider.verifyAccessToken.mockResolvedValue({
      externalId: 'ext-1',
      email: 'a@example.com',
      emailVerified: true,
    });
    usersRepository.upsertFromIdentity.mockResolvedValue(internalUser);

    await expect(guard.canActivate(contextWith('bearer good-token'))).resolves.toBe(true);
  });
  describe('age gate (ADR-042)', () => {
    const identity: AuthIdentity = { externalId: 'ext-1', email: 'a@example.com', emailVerified: true };

    beforeEach(() => {
      authProvider.verifyAccessToken.mockResolvedValue(identity);
      usersRepository.upsertFromIdentity.mockResolvedValue(internalUser);
    });

    it('refuses an account that has not given a date of birth, with a code the app can act on', async () => {
      usersRepository.hasDateOfBirth.mockResolvedValue(false);

      const attempt = guard.canActivate(contextWith('Bearer good-token'));

      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'date_of_birth_required' },
      });
    });

    it('lets a route marked AllowWithoutDateOfBirth through, so the date can be given at all', async () => {
      usersRepository.hasDateOfBirth.mockResolvedValue(false);

      await expect(guard.canActivate(contextWith('Bearer good-token', true))).resolves.toBe(true);
      expect(usersRepository.hasDateOfBirth).not.toHaveBeenCalled();
    });

    it('lets an account with a date of birth through', async () => {
      usersRepository.hasDateOfBirth.mockResolvedValue(true);

      await expect(guard.canActivate(contextWith('Bearer good-token'))).resolves.toBe(true);
      expect(usersRepository.hasDateOfBirth).toHaveBeenCalledWith('user-1');
    });

    it('remembers a positive answer, so the check is not a database read on every request', async () => {
      for (let i = 0; i < 5; i += 1) {
        await guard.canActivate(contextWith('Bearer good-token'));
      }

      expect(usersRepository.hasDateOfBirth).toHaveBeenCalledTimes(1);
    });

    it('does not remember a negative answer -- the moment the date is given, the next request passes', async () => {
      usersRepository.hasDateOfBirth.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(guard.canActivate(contextWith('Bearer good-token'))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(guard.canActivate(contextWith('Bearer good-token'))).resolves.toBe(true);
    });
  });

  describe('cost', () => {
    const identity: AuthIdentity = {
      externalId: 'ext-1',
      email: 'a@example.com',
      emailVerified: true,
    };

    beforeEach(() => {
      authProvider.verifyAccessToken.mockResolvedValue(identity);
      usersRepository.upsertFromIdentity.mockResolvedValue(internalUser);
    });

    it('reads the user once across repeated requests from the same identity', async () => {
      for (let i = 0; i < 5; i += 1) {
        await guard.canActivate(contextWith('Bearer good-token'));
      }

      // The database read is what the cache exists to remove. Without this assertion the
      // cache could quietly stop working and every test would still pass.
      expect(usersRepository.upsertFromIdentity).toHaveBeenCalledTimes(1);
    });

    it('still verifies the token on every request', async () => {
      for (let i = 0; i < 5; i += 1) {
        await guard.canActivate(contextWith('Bearer good-token'));
      }

      // Caching this would be a security bug, not an optimisation: expiry is checked
      // during verification, so a skipped verification is a token that never expires.
      expect(authProvider.verifyAccessToken).toHaveBeenCalledTimes(5);
    });

    it('attaches the cached user to later requests', async () => {
      await guard.canActivate(contextWith('Bearer good-token'));

      const second = contextWith('Bearer good-token');
      await guard.canActivate(second);

      expect(second.switchToHttp().getRequest<{ user: User }>().user).toEqual(internalUser);
    });

    it('reads again for a different identity', async () => {
      await guard.canActivate(contextWith('Bearer good-token'));

      authProvider.verifyAccessToken.mockResolvedValue({ ...identity, externalId: 'ext-2' });
      await guard.canActivate(contextWith('Bearer other-token'));

      expect(usersRepository.upsertFromIdentity).toHaveBeenCalledTimes(2);
    });
  });
});
