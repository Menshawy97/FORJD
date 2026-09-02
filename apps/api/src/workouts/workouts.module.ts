import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ExercisesModule } from "../exercises/exercises.module";
import { UsersModule } from "../users/users.module";
import { WorkoutsController } from "./workouts.controller";
import { WorkoutsRepository } from "./workouts.repository";
import { WorkoutsService } from "./workouts.service";

/**
 * Mirrors `ExercisesModule` exactly, plus `ExercisesModule` itself: `WorkoutsService` needs
 * `ExercisesRepository.findVisibleIds` to validate that a template's referenced exercises
 * exist and are visible to the caller, which is exactly the outside consumer
 * `ExercisesModule`'s own export exists for.
 *
 * `AuthProviderModule`/`UsersModule` are here for `JwtAuthGuard`'s own dependencies.
 */
@Module({
  imports: [AuthProviderModule, UsersModule, ExercisesModule],
  controllers: [WorkoutsController],
  providers: [WorkoutsService, WorkoutsRepository, JwtAuthGuard],
})
export class WorkoutsModule {}
