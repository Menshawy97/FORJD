import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { BodyModule } from '../body/body.module';
import { StorageModule } from '../storage/storage.module';
import { WhoopModule } from '../integrations/whoop/whoop.module';
import { AccountController } from './account.controller';
import { AccountDeletionService } from './account-deletion.service';
import { UsersModule } from './users.module';

/**
 * `AccountDeletionService` needs `BodyRepository` (storage cleanup) and WHOOP's connection
 * repository/client/cipher (grant revocation) alongside `UsersModule` -- but both `BodyModule`
 * and `WhoopModule` already import `UsersModule` themselves, so this module sits above all
 * three rather than either of them importing the other and creating a cycle.
 */
@Module({
  imports: [AuthProviderModule, UsersModule, BodyModule, WhoopModule, StorageModule],
  controllers: [AccountController],
  providers: [AccountDeletionService],
})
export class AccountModule {}
