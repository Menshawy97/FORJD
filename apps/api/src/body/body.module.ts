import { Module } from "@nestjs/common";

import { AiModule } from "../ai/ai.module";
import { AuthProviderModule } from "../auth/auth-provider.module";
import { StorageModule } from "../storage/storage.module";
import { UsersModule } from "../users/users.module";
import { BodyController } from "./body.controller";
import { BodyRepository } from "./body.repository";
import { BodyService } from "./body.service";

/** AuthProviderModule + UsersModule: JwtAuthGuard (used on BodyController) needs both
 *  AUTH_PROVIDER and UsersRepository injected -- the same two imports workouts.module.ts
 *  and every other guarded controller's module needs. */
@Module({
  imports: [AiModule, AuthProviderModule, StorageModule, UsersModule],
  controllers: [BodyController],
  providers: [BodyService, BodyRepository],
})
export class BodyModule {}
