import { Module } from '@nestjs/common';

import { expoPushProvider } from './expo-push-provider';
import { NOTIFICATION_PROVIDER } from './notification-provider';

/**
 * Provides the `NotificationProvider` (the Expo adapter) to whichever module sends a push (Phase 12F). Not imported by
 * `AppModule` yet: the dispatch service that uses it arrives in slice 3, and an integration nothing consumes has no
 * reason to be in the boot graph (the same call `TurnstileModule` made).
 */
@Module({
  providers: [expoPushProvider],
  exports: [NOTIFICATION_PROVIDER],
})
export class PushModule {}
