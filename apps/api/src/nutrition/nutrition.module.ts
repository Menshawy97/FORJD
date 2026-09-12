import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersModule } from "../users/users.module";
import { NutritionController } from "./nutrition.controller";
import { NutritionRepository } from "./nutrition.repository";
import { NutritionService } from "./nutrition.service";

/**
 * `AuthProviderModule`/`UsersModule` are for `JwtAuthGuard`'s own dependencies.
 *
 * `NutritionRepository` is now exported (R4): `AccountModule` needs `listAllForUserForExport`
 * for `GET /users/me/export`, the same reason `BodyModule`/`HealthDataModule` already export
 * their own repositories to it.
 */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [NutritionController],
  providers: [NutritionService, NutritionRepository, JwtAuthGuard],
  exports: [NutritionRepository],
})
export class NutritionModule {}
