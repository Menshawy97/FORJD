import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { UsersModule } from "../users/users.module";
import { HealthDataController } from "./health-data.controller";
import { HealthDataRepository } from "./health-data.repository";
import { HealthDataService } from "./health-data.service";

/** AuthProviderModule + UsersModule: JwtAuthGuard (used on HealthDataController) needs both
 *  AUTH_PROVIDER and UsersRepository injected -- same two imports BodyModule/WorkoutsModule
 *  need for the same reason. */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [HealthDataController],
  providers: [HealthDataService, HealthDataRepository],
})
export class HealthDataModule {}
