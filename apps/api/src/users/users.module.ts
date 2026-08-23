import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrivacyRepository } from '../privacy/privacy.repository';
import { PrivacyService } from '../privacy/privacy.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * PrivacyRepository is registered here rather than in a module of its own because privacy
 * settings are reached through the user: they ride along on `meResponse` and are written by
 * `PATCH /users/me/privacy`. A separate module would exist only to be imported by this one.
 */
@Module({
  imports: [AuthProviderModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, PrivacyRepository, PrivacyService, JwtAuthGuard],
  exports: [UsersRepository, PrivacyRepository, PrivacyService],
})
export class UsersModule {}
