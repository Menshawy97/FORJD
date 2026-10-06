import { Body, Controller, Delete, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { registerPushTokenRequestSchema, removePushTokenRequestSchema } from '@forjd/contracts';
import type { RegisterPushTokenRequest, RemovePushTokenRequest } from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PushTokensService } from './push-tokens.service';

/**
 * `POST`/`DELETE /api/v1/users/me/push-tokens` (Phase 12F): the phone registers its push token once it has
 * permission and removes it before sign-out. Additive to `/api/v1` (rule 7). The `JwtAuthGuard` default (age gate
 * included) applies, like the notification switches.
 */
@Controller('users/me/push-tokens')
@UseGuards(JwtAuthGuard)
export class PushTokensController {
  constructor(private readonly service: PushTokensService) {}

  @Post()
  @HttpCode(204)
  register(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(registerPushTokenRequestSchema)) body: RegisterPushTokenRequest,
  ): Promise<void> {
    return this.service.register(request.user, body);
  }

  @Delete()
  @HttpCode(204)
  remove(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(removePushTokenRequestSchema)) body: RemovePushTokenRequest,
  ): Promise<void> {
    return this.service.remove(request.user, body);
  }
}
