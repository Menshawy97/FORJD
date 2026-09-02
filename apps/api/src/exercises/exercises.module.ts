import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersModule } from "../users/users.module";
import { ExercisesController } from "./exercises.controller";
import { ExercisesRepository } from "./exercises.repository";
import { ExercisesService } from "./exercises.service";

/**
 * `ExercisesRepository` is exported for Phase 3's workout engine, its first outside
 * consumer -- `WorkoutsModule` imports this module to validate that a template's referenced
 * `exerciseId`s exist and are visible to the caller, via `findVisibleIds`, without a second
 * copy of the ownership/visibility rule this module already owns.
 *
 * `AuthProviderModule` and `UsersModule` are here for `JwtAuthGuard`'s dependencies, the same
 * wiring `AthletesModule` uses.
 */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [ExercisesController],
  providers: [ExercisesService, ExercisesRepository, JwtAuthGuard],
  exports: [ExercisesRepository],
})
export class ExercisesModule {}
