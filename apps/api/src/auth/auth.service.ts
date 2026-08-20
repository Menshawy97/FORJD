import { Inject, Injectable } from '@nestjs/common';
import type {
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  SessionResponse,
} from '@forjd/contracts';

import { UsersRepository } from '../users/users.repository';
import { AUTH_PROVIDER, AuthProvider, AuthSession } from './providers/auth-provider.interface';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
    private readonly usersRepository: UsersRepository,
  ) {}

  async register(request: RegisterRequest): Promise<RegisterResponse> {
    const { identity, session } = await this.authProvider.signUp(request);
    const user = await this.usersRepository.upsertFromIdentity(identity.externalId, identity.email);

    // The name lands in `profiles`, not in the auth provider's user metadata. `profiles` is
    // what /users/me reads and PATCH /users/me/profile writes, so storing it upstream too
    // would create a second copy that diverges the first time the user edits their name.
    if (request.displayName) {
      await this.usersRepository.updateProfile(user.id, { displayName: request.displayName });
    }

    await this.usersRepository.recordAudit(user.id, 'auth.register', {
      emailVerified: identity.emailVerified,
    });

    return {
      userId: user.id,
      email: user.email,
      emailVerified: identity.emailVerified,
      session: session ? this.toSessionResponse(session) : null,
    };
  }

  async login(request: LoginRequest): Promise<SessionResponse> {
    const { identity, session } = await this.authProvider.signIn(request);
    const user = await this.usersRepository.upsertFromIdentity(identity.externalId, identity.email);

    await this.usersRepository.recordAudit(user.id, 'auth.login');

    return this.toSessionResponse(session);
  }

  async refresh(refreshToken: string): Promise<SessionResponse> {
    return this.toSessionResponse(await this.authProvider.refreshSession(refreshToken));
  }

  /**
   * The audit entry is written against a null user id on purpose. Resolving the address to
   * a user first would make the response measurably slower when the account exists,
   * reintroducing through latency the enumeration channel the constant 202 closes.
   */
  async requestPasswordReset(email: string): Promise<void> {
    await this.authProvider.requestPasswordReset(email);
    await this.usersRepository.recordAudit(null, 'auth.password_reset_requested', { email });
  }

  async logout(accessToken: string, userId: string | null): Promise<void> {
    await this.authProvider.signOut(accessToken);
    await this.usersRepository.recordAudit(userId, 'auth.logout');
  }

  private toSessionResponse(session: AuthSession): SessionResponse {
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
