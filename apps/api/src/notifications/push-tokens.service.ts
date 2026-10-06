import { Injectable } from '@nestjs/common';
import type { RegisterPushTokenRequest, RemovePushTokenRequest } from '@forjd/contracts';
import type { User } from '@forjd/domain';

import { PushTokensRepository } from './push-tokens.repository';

/**
 * The caller's own push tokens (Phase 12F). The id comes from the authenticated user, never from the request, so
 * there is no way to register a token for, or remove one from, another account (CLAUDE.md rule 12).
 */
@Injectable()
export class PushTokensService {
  constructor(private readonly repository: PushTokensRepository) {}

  async register(user: User, body: RegisterPushTokenRequest): Promise<void> {
    await this.repository.register(user.id, body.token, body.platform);
  }

  /** A token that is not the caller's, or not stored, is not an error: the answer must not reveal who holds what. */
  async remove(user: User, body: RemovePushTokenRequest): Promise<void> {
    await this.repository.remove(user.id, body.token);
  }
}
