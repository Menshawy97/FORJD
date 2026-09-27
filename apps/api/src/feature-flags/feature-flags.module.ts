import { Module } from '@nestjs/common';

import { FeatureFlagsRepository } from './feature-flags.repository';

/** The `feature_flags` reader. Its route (`GET /feature-flags`) arrives with Weekly Forge Phase 6. */
@Module({
  providers: [FeatureFlagsRepository],
  exports: [FeatureFlagsRepository],
})
export class FeatureFlagsModule {}
