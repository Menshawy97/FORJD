import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { UsersModule } from '../users/users.module';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PushTokensController } from './push-tokens.controller';
import { PushTokensRepository } from './push-tokens.repository';
import { PushTokensService } from './push-tokens.service';

/**
 * The notification switches (Phase 12D) and the device push tokens (Phase 12F). `AuthProviderModule` and `UsersModule` are for
 * `JwtAuthGuard`, as in every guarded module.
 */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [NotificationPreferencesController, PushTokensController],
  providers: [NotificationPreferencesRepository, NotificationPreferencesService, PushTokensRepository, PushTokensService],
})
export class NotificationsModule {}
