import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersModule } from "../users/users.module";
import { NutritionController } from "./nutrition.controller";
import { NutritionRepository } from "./nutrition.repository";
import { NutritionService } from "./nutrition.service";

/** Mirrors `ExercisesModule` exactly: `NutritionRepository` provided here rather than exported, since nothing outside this feature reads nutrition data yet. `AuthProviderModule`/`UsersModule` are for `JwtAuthGuard`'s own dependencies. */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [NutritionController],
  providers: [NutritionService, NutritionRepository, JwtAuthGuard],
})
export class NutritionModule {}
