import { Body, Controller, HttpCode, HttpStatus, Put, Req, UseGuards } from '@nestjs/common';
import { timeZoneUpdateRequestSchema } from '@forjd/contracts';
import type { TimeZoneUpdateRequest } from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ForgeService } from './forge.service';

/**
 * `PUT /api/v1/users/me/timezone`: the phone sends its IANA zone, which is where the athlete's
 * Forge weeks close (ADR-057 decision 3). Not behind the flag: storing a zone is harmless, and the
 * phone can send it before the feature is switched on. Lives with Weekly Forge because Forge is
 * the only reader of `preferences.timezone`.
 */
@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class TimeZoneController {
  constructor(private readonly forgeService: ForgeService) {}

  @Put('timezone')
  @HttpCode(HttpStatus.NO_CONTENT)
  update(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(timeZoneUpdateRequestSchema)) body: TimeZoneUpdateRequest,
  ): Promise<void> {
    return this.forgeService.setTimeZone(request.user.id, body.timeZone);
  }
}
