import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { UsersModule } from '../users/users.module';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * The notification switches (Phase 12D). `AuthProviderModule` and `UsersModule` are for
 * `JwtAuthGuard`, as in every guarded module.
 */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [NotificationPreferencesController],
  providers: [NotificationPreferencesRepository, NotificationPreferencesService],
})
export class NotificationsModule {}
