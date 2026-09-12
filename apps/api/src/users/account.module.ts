import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { BodyModule } from '../body/body.module';
import { HealthDataModule } from '../health-data/health-data.module';
import { StorageModule } from '../storage/storage.module';
import { WhoopModule } from '../integrations/whoop/whoop.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { ProgramsModule } from '../programs/programs.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { AccountController } from './account.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountExportService } from './account-export.service';
import { UsersModule } from './users.module';

/**
 * `AccountDeletionService` needs `BodyRepository` (storage cleanup) and WHOOP's connection
 * repository/client/cipher (grant revocation) alongside `UsersModule` -- but both `BodyModule`
 * and `WhoopModule` already import `UsersModule` themselves, so this module sits above all
 * three rather than either of them importing the other and creating a cycle.
 *
 * R4 adds `AccountExportService`, which needs the same shape of access across four more
 * feature modules (`HealthDataModule`, `NutritionModule`, `WorkoutsModule`, `ProgramsModule`)
 * for the same reason -- none of the four import `AccountModule`, so importing them here
 * creates no cycle, exactly like `BodyModule`/`WhoopModule` above.
 */
@Module({
  imports: [
    AuthProviderModule,
    UsersModule,
    BodyModule,
    WhoopModule,
    StorageModule,
    HealthDataModule,
    NutritionModule,
    WorkoutsModule,
    ProgramsModule,
  ],
  controllers: [AccountController],
  providers: [AccountDeletionService, AccountExportService],
})
export class AccountModule {}
