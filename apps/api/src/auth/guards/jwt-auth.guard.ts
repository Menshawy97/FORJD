import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '@forjd/domain';
import { Request } from 'express';

import { UsersRepository } from '../../users/users.repository';
import { AUTH_PROVIDER, AuthProvider } from '../providers/auth-provider.interface';
import { IdentityCache } from './identity-cache';

export interface AuthenticatedRequest extends Request {
  user: User;
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

    request.user =
      this.identities.get(identity.externalId, identity.email) ??
      (await this.resolveAndCache(identity.externalId, identity.email));

    return true;
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
