import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ExercisesModule } from "../exercises/exercises.module";
import { UsersModule } from "../users/users.module";
import { ProgressRepository } from "./progress.repository";
import { ProgressService } from "./progress.service";
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
 *
 * `WorkoutsRepository` is exported (R4): `AccountModule` needs `listOwnTemplateIdsForUser` /
 * `listSessionIdsForUser` / `findByIdForUser` / `findSessionByIdForUser` for
 * `GET /users/me/export`, the same reason `BodyModule` and `HealthDataModule` already export
 * their own repositories to it.
 */
@Module({
  imports: [AuthProviderModule, UsersModule, ExercisesModule],
  controllers: [WorkoutsController, WorkoutSessionsController],
  providers: [
    WorkoutsService,
    WorkoutSessionsService,
    WorkoutsRepository,
    ProgressService,
    ProgressRepository,
    JwtAuthGuard,
  ],
  exports: [WorkoutsRepository],
})
export class WorkoutsModule {}
