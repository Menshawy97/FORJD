import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '@forjd/domain';
import { Request } from 'express';

import { UsersRepository } from '../../users/users.repository';
import { AUTH_PROVIDER, AuthIdentity, AuthProvider } from '../providers/auth-provider.interface';
import { ALLOW_WITHOUT_DATE_OF_BIRTH } from './allow-without-date-of-birth.decorator';
import { IdentityCache } from './identity-cache';

export interface AuthenticatedRequest extends Request {
  user: User;
  /** The verified upstream identity behind `user`. Survives even if the local row was deleted. */
  identity: AuthIdentity;
}

/**
 * Authorization lives here, in code that can be unit-tested against a mocked AuthProvider —
 * not only in an RLS policy. RLS remains as defense in depth (CLAUDE.md rule 12).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
    private readonly usersRepository: UsersRepository,
    private readonly identities: IdentityCache,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    // Verified every time, never cached. Expiry is checked here, so a skipped
    // verification is a token that outlives its own lifetime. It costs no network call
    // now (ADR-012), which is what makes doing it every request affordable.
    const identity = await this.authProvider.verifyAccessToken(token);

    request.identity = identity;
    request.user =
      this.identities.get(identity.externalId, identity.email) ??
      (await this.resolveAndCache(identity.externalId, identity.email));

    await this.requireDateOfBirth(context, identity);

    return true;
  }

  /**
   * ADR-042 -- the age gate is enforced here, not only in the app (CLAUDE.md rule 12): an
   * account with no date of birth on file may reach only the routes marked
   * `@AllowWithoutDateOfBirth()`. A positive answer is remembered on the identity cache entry;
   * a negative one never is, so the request right after the date is given already passes.
   */
  private async requireDateOfBirth(context: ExecutionContext, identity: AuthIdentity): Promise<void> {
    const open = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_WITHOUT_DATE_OF_BIRTH, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (open) {
      return;
    }

    if (this.identities.hasDateOfBirth(identity.externalId, identity.email)) {
      return;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!(await this.usersRepository.hasDateOfBirth(request.user.id))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'date_of_birth_required',
        message: 'Enter your date of birth to continue.',
      });
    }

    this.identities.markDateOfBirthSet(identity.externalId, identity.email);
  }

  private async resolveAndCache(externalId: string, email: string): Promise<User> {
    const user = await this.usersRepository.upsertFromIdentity(externalId, email);
    this.identities.set(externalId, email, user);

    return user;
  }

  private extractBearerToken(header: string | undefined): string | null {
    if (!header) {
      return null;
    }

    const [scheme, value] = header.split(' ');

    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
