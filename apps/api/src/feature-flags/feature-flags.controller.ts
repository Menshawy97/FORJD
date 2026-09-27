import { Controller, Get, UseGuards } from '@nestjs/common';
import type { FeatureFlagsResponse } from '@forjd/contracts';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureFlagsRepository } from './feature-flags.repository';

/** `GET /api/v1/feature-flags`: the keys of every flag switched on, read by the phone at launch. */
@Controller('feature-flags')
@UseGuards(JwtAuthGuard)
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsRepository) {}

  @Get()
  async list(): Promise<FeatureFlagsResponse> {
    return { enabled: await this.flags.enabledKeys() };
  }
}
