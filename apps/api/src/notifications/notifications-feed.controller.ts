import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { NotificationListResponse } from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsFeedService } from './notifications-feed.service';

/**
 * `GET /api/v1/users/me/notifications/feed` (walk finding 17): the list behind the Home bell. Its own path, because
 * `GET /users/me/notifications` is already the notification switches. Additive to `/api/v1` (rule 7).
 * The `JwtAuthGuard` default (age gate included) applies, like the push tokens; the caller is the only user it reads.
 */
@Controller('users/me/notifications/feed')
@UseGuards(JwtAuthGuard)
export class NotificationsFeedController {
  constructor(private readonly service: NotificationsFeedService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest): Promise<NotificationListResponse> {
    return this.service.list(request.user);
  }
}
