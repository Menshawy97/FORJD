import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { leaderboardQuerySchema } from '@forjd/contracts';
import type { LeaderboardQuery, LeaderboardResponse } from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LeaderboardsService } from './leaderboards.service';

/**
 * `GET /api/v1/leaderboards` (Phase 10). Always the caller's own city: there is no city parameter,
 * so nobody can read another city's board by asking for it, and the caller's city comes from
 * where their workouts happened (`LeaderboardsService`).
 *
 * There is no cursor and no page number on purpose: the design shows a window around the caller
 * (ranks 44-50 with the caller at 47), so the contract is "a window around me" and `window` says
 * how many rows either side.
 */
@Controller('leaderboards')
@UseGuards(JwtAuthGuard)
export class LeaderboardsController {
  constructor(private readonly leaderboardsService: LeaderboardsService) {}

  @Get()
  get(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(leaderboardQuerySchema)) query: LeaderboardQuery,
  ): Promise<LeaderboardResponse> {
    return this.leaderboardsService.get(request.user, query);
  }
}
