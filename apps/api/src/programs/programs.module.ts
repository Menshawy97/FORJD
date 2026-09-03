import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../auth/auth-provider.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersModule } from "../users/users.module";
import { ProgramsController } from "./programs.controller";
import { ProgramsRepository } from "./programs.repository";
import { ProgramsService } from "./programs.service";

/**
 * `AuthProviderModule` and `UsersModule` are here for `JwtAuthGuard`'s own dependencies -- the
 * same wiring `ExercisesModule` and `AthletesModule` use.
 *
 * `ProgramsSeedRepository` is deliberately **not** provided here. It is a CLI-only write path for
 * null-owner catalogue rows, reached by `programs:seed` through a plain `new`, and putting it in
 * the DI graph would leave the request path one injection away from a repository whose whole job
 * is to write rows nobody owns.
 *
 * `ProgramsRepository` is exported ahead of K3, which adds enrolment writes and needs the same
 * visibility rule this module already owns rather than a second copy of it.
 */
@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [ProgramsController],
  providers: [ProgramsService, ProgramsRepository, JwtAuthGuard],
  exports: [ProgramsRepository],
})
export class ProgramsModule {}
