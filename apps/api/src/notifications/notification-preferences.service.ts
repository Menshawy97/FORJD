import { Injectable } from '@nestjs/common';
import type { NotificationPreferencesResponse, UpdateNotificationPreferencesRequest } from '@forjd/contracts';
import type { User } from '@forjd/domain';

import { NotificationPreferencesRepository } from './notification-preferences.repository';

/**
 * The five notification switches (Phase 12D). Always the caller's own row: the id comes from the
 * authenticated user, never from the request, so there is no way to name another account
 * (CLAUDE.md rule 12).
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly repository: NotificationPreferencesRepository) {}

  async get(user: User): Promise<NotificationPreferencesResponse> {
    const { preferences, quietHours, updatedAt } = await this.repository.get(user.id);
    return { ...preferences, quietHours, updatedAt: updatedAt === null ? null : updatedAt.toISOString() };
  }

  async update(user: User, body: UpdateNotificationPreferencesRequest): Promise<NotificationPreferencesResponse> {
    const { preferences, quietHours, updatedAt } = await this.repository.upsert(user.id, body);
    return { ...preferences, quietHours, updatedAt: updatedAt.toISOString() };
  }
}
