import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { profiles } from '../database/schema/profiles.schema';
import { users } from '../database/schema/users.schema';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers/storage-provider.interface';
import { BodyRepository } from '../body/body.repository';
import { INBODY_BUCKET } from '../body/body.service';
import { TOKEN_CIPHER, TokenCipher } from '../common/crypto/token-cipher.provider';
import { WHOOP_CLIENT, WhoopClient } from '../integrations/whoop/whoop-client';
import { WhoopConnectionRepository } from '../integrations/whoop/whoop-connection.repository';
import { revokeAndClearWhoopConnection } from '../integrations/whoop/whoop-revoke';
import { AVATAR_BUCKET, avatarKeyFromUrl } from './avatar-upload.service';

/**
 * C1 -- account deletion did not exist. Health observations, body scans, nutrition logs,
 * profile and WHOOP tokens persisted forever: cascades were correctly wired on every
 * `user_id` foreign key, but nothing ever deleted the parent `users` row to trigger them, and
 * InBody scan photos + the avatar in Supabase Storage have no foreign key at all -- a
 * cascaded scan row leaves its photo orphaned in the bucket forever unless something deletes
 * it explicitly. This service is that something.
 *
 * Order matters and is deliberate: storage objects and the WHOOP grant first (both need data
 * -- `photoKey`, the encrypted tokens -- that only exists while the user row and its children
 * are still present), the user row last. A crash partway through this method leaves a user
 * who can retry deletion, never an orphaned data set with no owner to retry it.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
    private readonly bodyRepository: BodyRepository,
    private readonly whoopConnections: WhoopConnectionRepository,
    @Inject(WHOOP_CLIENT) private readonly whoopClient: WhoopClient,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
  ) {}

  async deleteAccount(userId: string): Promise<void> {
    await this.deleteStorageObjects(userId);
    await revokeAndClearWhoopConnection(userId, this.whoopConnections, this.whoopClient, this.cipher);
    await this.db.delete(users).where(eq(users.id, userId));
  }

  private async deleteStorageObjects(userId: string): Promise<void> {
    const photoKeys = await this.bodyRepository.listScanPhotoKeysForUser(userId);
    for (const photoKey of photoKeys) {
      await this.tryDeleteObject({ bucket: INBODY_BUCKET, key: photoKey });
    }

    const [profile] = await this.db.select().from(profiles).where(eq(profiles.userId, userId));
    if (profile?.avatarUrl) {
      const key = avatarKeyFromUrl(profile.avatarUrl);
      if (key) {
        await this.tryDeleteObject({ bucket: AVATAR_BUCKET, key });
      }
    }
  }

  /**
   * A storage object that is already gone, or a transient Storage error, must not abort the
   * rest of deletion -- leaving an account undeletable because one object 404s is a worse
   * outcome than a logged, orphaned object.
   */
  private async tryDeleteObject(ref: { bucket: string; key: string }): Promise<void> {
    try {
      await this.storageProvider.delete(ref);
    } catch (error) {
      this.logger.warn(`Failed to delete storage object ${ref.bucket}/${ref.key} during account deletion`, error);
    }
  }
}
