import { Module } from "@nestjs/common";

import { AuthProviderModule } from "../../auth/auth-provider.module";
import { UsersModule } from "../../users/users.module";
import { TOKEN_CIPHER, tokenCipherProvider } from "../../common/crypto/token-cipher.provider";
import { HealthDataModule } from "../../health-data/health-data.module";
import { WhoopCallbackService } from "./whoop-callback.service";
import { WhoopConnectionRepository } from "./whoop-connection.repository";
import { WHOOP_CLIENT, whoopClientProvider } from "./whoop-client";
import { whoopOAuthServiceProvider } from "./whoop-oauth.service";
import { WhoopProviderFactory } from "./whoop-provider.factory";
import { WhoopSyncService } from "./whoop-sync.service";
import { WhoopController } from "./whoop.controller";
import { WhoopWebhookService } from "./whoop-webhook.service";

/**
 * `AuthProviderModule` + `UsersModule`: `JwtAuthGuard` (used on the three authenticated
 * routes) needs both `AUTH_PROVIDER` and `UsersRepository`, same reason `HealthDataModule`
 * imports them. `HealthDataModule` itself: `WhoopSyncService`/`WhoopWebhookService` both
 * ingest into `health_observations` through its exported `HealthDataRepository` singleton,
 * reused rather than duplicated.
 */
@Module({
  imports: [AuthProviderModule, UsersModule, HealthDataModule],
  controllers: [WhoopController],
  providers: [
    tokenCipherProvider,
    whoopClientProvider,
    whoopOAuthServiceProvider,
    WhoopConnectionRepository,
    WhoopCallbackService,
    WhoopProviderFactory,
    WhoopSyncService,
    WhoopWebhookService,
  ],
  exports: [WhoopConnectionRepository, WHOOP_CLIENT, TOKEN_CIPHER],
})
export class WhoopModule {}
