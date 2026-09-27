import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { UsersModule } from '../users/users.module';
import { ForgeEvaluationService } from './forge-evaluation.service';
import { ForgeReadRepository } from './forge-read.repository';
import { ForgeRefoldRepository } from './forge-refold.repository';
import { ForgeStateRepository } from './forge-state.repository';
import { ForgeTotalsRepository } from './forge-totals.repository';
import { ForgeController } from './forge.controller';
import { ForgeService } from './forge.service';
import { TimeZoneController } from './time-zone.controller';

/**
 * Weekly Forge (ADR-057): the routes, the evaluation, and the reads behind the public profile's
 * Forge block. `AuthProviderModule` and `UsersModule` are for `JwtAuthGuard`, as in every guarded
 * module.
 */
@Module({
  imports: [AuthProviderModule, UsersModule, FeatureFlagsModule],
  controllers: [ForgeController, TimeZoneController],
  providers: [
    ForgeTotalsRepository,
    ForgeStateRepository,
    ForgeReadRepository,
    ForgeRefoldRepository,
    ForgeEvaluationService,
    ForgeService,
  ],
  exports: [ForgeService, ForgeEvaluationService],
})
export class ForgeModule {}
