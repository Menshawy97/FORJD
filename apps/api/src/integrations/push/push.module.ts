import { Module } from '@nestjs/common';

import { expoPushProvider } from './expo-push-provider';
import { NOTIFICATION_PROVIDER } from './notification-provider';

/**
 * Provides the `NotificationProvider` (the Expo adapter) to whichever module sends a push (Phase 12F). `NotificationsModule`
 * imports it for the dispatch service.
 */
@Module({
  providers: [expoPushProvider],
  exports: [NOTIFICATION_PROVIDER],
})
export class PushModule {}
