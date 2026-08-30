import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersModule } from "../users/users.module";
import { ExercisesController } from "./exercises.controller";
import { ExercisesRepository } from "./exercises.repository";
import { ExercisesService } from "./exercises.service";

/**
 * `ExercisesRepository` is provided here rather than exported from a shared module, because
 * nothing outside this feature reads exercises yet. Phase 3's workout engine will need it, and
 * exporting it then -- when there is a second consumer to point at -- is a smaller change than
 * unpicking a premature shared module now.
 *
 * `AuthProviderModule` and `UsersModule` are here for `JwtAuthGuard`'s dependencies, the same
 * wiring `AthletesModule` uses.
 */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [ExercisesController],
  providers: [ExercisesService, ExercisesRepository, JwtAuthGuard],
})
export class ExercisesModule {}
