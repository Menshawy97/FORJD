import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { UsersModule } from '../users/users.module';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsRepository } from './feature-flags.repository';

/** The `feature_flags` reader and `GET /feature-flags`. Auth and Users are for `JwtAuthGuard`. */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsRepository],
  exports: [FeatureFlagsRepository],
})
export class FeatureFlagsModule {}
