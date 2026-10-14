import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { PushModule } from '../integrations/push/push.module';
import { UsersModule } from '../users/users.module';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsFeedController } from './notifications-feed.controller';
import { NotificationsFeedService } from './notifications-feed.service';
import { PushNotificationService } from './push-notification.service';
import { PushOutboxRepository } from './push-outbox.repository';
import { PushTokensController } from './push-tokens.controller';
import { PushTokensRepository } from './push-tokens.repository';
import { PushTokensService } from './push-tokens.service';

/**
 * The notification switches (Phase 12D) and the device push tokens (Phase 12F). `AuthProviderModule` and `UsersModule` are for
 * `JwtAuthGuard`, as in every guarded module.
 */
@Module({
  imports: [AuthProviderModule, UsersModule, PushModule],
  controllers: [NotificationPreferencesController, PushTokensController, NotificationsFeedController],
  providers: [
    NotificationsFeedService,
    NotificationPreferencesRepository,
    NotificationPreferencesService,
    PushTokensRepository,
    PushTokensService,
    PushOutboxRepository,
    PushNotificationService,
  ],
  // The senders (the PR sender at upload, the snapshot script) queue pushes through this; the drain workflow calls `drain`.
  exports: [PushNotificationService],
})
export class NotificationsModule {}
