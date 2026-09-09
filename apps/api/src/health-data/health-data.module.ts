import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { UsersModule } from "../users/users.module";
import { HealthDataController } from "./health-data.controller";
import { HealthDataRepository } from "./health-data.repository";
import { HealthDataService } from "./health-data.service";

/** AuthProviderModule + UsersModule: JwtAuthGuard (used on HealthDataController) needs both
 *  AUTH_PROVIDER and UsersRepository injected -- same two imports BodyModule/WorkoutsModule
 *  need for the same reason. `HealthDataRepository` is exported so other provider
 *  integrations (WhoopModule, Phase 7) can ingest into `health_observations` through the
 *  same singleton this module already owns, rather than each standing up its own. */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [HealthDataController],
  providers: [HealthDataService, HealthDataRepository],
  exports: [HealthDataRepository],
})
export class HealthDataModule {}
