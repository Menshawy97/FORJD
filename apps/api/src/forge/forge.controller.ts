import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { forgeWeekParamsSchema } from '@forjd/contracts';
import type { ForgePendingWeeksResponse, ForgeResponse, ForgeWeekParams } from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ForgeService } from './forge.service';

/**
 * Weekly Forge (ADR-057). Always the caller's own ladders: no route takes a user id. Every route
 * answers 404 while the `weekly_forge` flag is off.
 */
@Controller('forge')
@UseGuards(JwtAuthGuard)
export class ForgeController {
  constructor(private readonly forgeService: ForgeService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest): Promise<ForgeResponse> {
    return this.forgeService.getForge(request.user.id, new Date());
  }

  @Get('weeks/pending')
  pending(@Req() request: AuthenticatedRequest): Promise<ForgePendingWeeksResponse> {
    return this.forgeService.pendingWeeks(request.user.id, new Date());
  }

  @Post('weeks/:weekStart/ack')
  @HttpCode(HttpStatus.NO_CONTENT)
  acknowledge(
    @Req() request: AuthenticatedRequest,
    @Param(new ZodValidationPipe(forgeWeekParamsSchema)) params: ForgeWeekParams,
  ): Promise<void> {
    return this.forgeService.acknowledge(request.user.id, params.weekStart);
  }
}
