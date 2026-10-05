import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { updateNotificationPreferencesRequestSchema } from '@forjd/contracts';
import type { NotificationPreferencesResponse, UpdateNotificationPreferencesRequest } from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * `GET`/`PATCH /api/v1/users/me/notifications` (Phase 12D): the five switches on the Notifications
 * screen. Additive to `/api/v1` (rule 7). The `JwtAuthGuard` default (age gate included) applies:
 * this is a settings screen a signed-in adult reaches, so nothing opts out.
 */
@Controller('users/me/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest): Promise<NotificationPreferencesResponse> {
    return this.service.get(request.user);
  }

  @Patch()
  update(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateNotificationPreferencesRequestSchema)) body: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferencesResponse> {
    return this.service.update(request.user, body);
  }
}
