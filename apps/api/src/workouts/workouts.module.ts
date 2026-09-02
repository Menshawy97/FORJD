import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ExercisesModule } from "../exercises/exercises.module";
import { UsersModule } from "../users/users.module";
import { WorkoutSessionsController } from "./workout-sessions.controller";
import { WorkoutSessionsService } from "./workout-sessions.service";
import { WorkoutsController } from "./workouts.controller";
import { WorkoutsRepository } from "./workouts.repository";
import { WorkoutsService } from "./workouts.service";

/**
 * Mirrors `ExercisesModule` exactly, plus `ExercisesModule` itself: `WorkoutsService` and
 * `WorkoutSessionsService` both need `ExercisesRepository` (`findVisibleIds` /
 * `findManyVisibleForUser`) to validate exercise references, which is exactly the outside
 * consumer `ExercisesModule`'s own export exists for.
 *
 * Two controllers, two services, one repository, one module -- templates and sessions are
 * independent aggregates (see `WorkoutsService`'s own docblock) that share the underlying
 * schema and the module wiring, the same shape `NutritionModule` uses for its own several
 * tables under one controller/service/repository set.
 *
 * `AuthProviderModule`/`UsersModule` are here for `JwtAuthGuard`'s own dependencies.
 */
@Module({
  imports: [AuthProviderModule, UsersModule, ExercisesModule],
  controllers: [WorkoutsController, WorkoutSessionsController],
  providers: [WorkoutsService, WorkoutSessionsService, WorkoutsRepository, JwtAuthGuard],
})
export class WorkoutsModule {}
