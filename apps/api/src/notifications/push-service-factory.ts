import type { Database } from '../database/database.module';
import type { NotificationProvider } from '../integrations/push/notification-provider';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { PushNotificationService } from './push-notification.service';
import { PushOutboxRepository } from './push-outbox.repository';
import { PushTokensRepository } from './push-tokens.repository';

/** Builds the push service outside Nest, for the two scripts that run it (the weekly snapshot and the drain). */
export function createPushNotificationService(db: Database, provider: NotificationProvider): PushNotificationService {
  return new PushNotificationService(
    new PushOutboxRepository(db),
    new PushTokensRepository(db),
    new NotificationPreferencesRepository(db),
    provider,
  );
}
