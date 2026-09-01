import { Inject, Logger, Module, OnModuleInit } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrivacyRepository } from '../privacy/privacy.repository';
import { PrivacyService } from '../privacy/privacy.service';
import { StorageModule } from '../storage/storage.module';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers/storage-provider.interface';
import { SubscriptionService } from '../subscription/subscription.service';
import { AVATAR_BUCKET, AvatarUploadService } from './avatar-upload.service';
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
  imports: [AuthProviderModule, StorageModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository,
    PrivacyRepository,
    PrivacyService,
    SubscriptionService,
    AvatarUploadService,
    JwtAuthGuard,
  ],
  exports: [UsersRepository, PrivacyRepository, PrivacyService, SubscriptionService],
})
/**
 * `ensureBucket` is deliberately called once here, at module bootstrap, rather than inside
 * `AvatarUploadService.upload` on every request -- `StorageProvider.ensureBucket`'s own doc
 * comment says as much: "Not exposed to request-serving code -- nothing in the request path
 * should be creating buckets." `onModuleInit` runs once per process start, which is the closest
 * available equivalent to the mirror script's own one-shot `ensureBucket` call (ADR-018) that a
 * long-running API process has.
 *
 * **Failure here must not fail the whole process boot.** A transient Supabase Storage blip, an
 * expired service-role key, or a storage-entitlement problem would otherwise throw out of
 * `NestFactory.create()` (Nest runs `onModuleInit` during app creation, before `app.listen()`),
 * taking down every unrelated route -- auth, exercises, nutrition -- for a dependency check on
 * one feature's bucket. Logged and swallowed instead: the steady state after the first
 * successful run is "bucket already exists" anyway, and a genuinely broken avatar upload still
 * fails per-request in `AvatarUploadService.upload`, where it belongs.
 */
export class UsersModule implements OnModuleInit {
  private readonly logger = new Logger(UsersModule.name);

  constructor(@Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.storageProvider.ensureBucket(AVATAR_BUCKET, { public: true });
    } catch (error) {
      this.logger.error('Failed to ensure the avatar storage bucket exists', error);
    }
  }
}
