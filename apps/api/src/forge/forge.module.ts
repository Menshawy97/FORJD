import { Module } from '@nestjs/common';

import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { ForgeEvaluationService } from './forge-evaluation.service';
import { ForgeStateRepository } from './forge-state.repository';
import { ForgeTotalsRepository } from './forge-totals.repository';

/**
 * Weekly Forge (ADR-057). Phase 5 wires the evaluation only; the routes (`GET /forge`, the pending
 * week summaries) arrive in Phase 6, behind the `weekly_forge` flag.
 */
@Module({
  imports: [FeatureFlagsModule],
  providers: [ForgeTotalsRepository, ForgeStateRepository, ForgeEvaluationService],
  exports: [ForgeEvaluationService],
})
export class ForgeModule {}
