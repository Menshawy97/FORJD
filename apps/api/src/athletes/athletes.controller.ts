import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { PublicProfileResponse } from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AthletesService } from './athletes.service';

/**
 * Authenticated-only. "Public" here means visible to other signed-in FORJD users, not to
 * search engines or an unauthenticated caller — the guard is what makes that true.
 */
@Controller('athletes')
@UseGuards(JwtAuthGuard)
export class AthletesController {
  constructor(private readonly athletesService: AthletesService) {}

  @Get(':userId')
  getPublicProfile(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<PublicProfileResponse> {
    return this.athletesService.getPublicProfile(request.user, userId);
  }
}
