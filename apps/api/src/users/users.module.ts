import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrivacyRepository } from '../privacy/privacy.repository';
import { PrivacyService } from '../privacy/privacy.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * PrivacyRepository and SubscriptionService are registered here rather than in modules of
 * their own for the same reason: both are reached only through the user (privacy rides along
 * on `meResponse`; plan is read into `profileResponseSchema`), so a separate module would
 * exist only to be imported by this one.
 */
@Module({
  imports: [AuthProviderModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository,
    PrivacyRepository,
    PrivacyService,
    SubscriptionService,
    JwtAuthGuard,
  ],
  exports: [UsersRepository, PrivacyRepository, PrivacyService, SubscriptionService],
})
export class UsersModule {}
