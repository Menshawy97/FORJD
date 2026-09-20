import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { CitiesModule } from '../cities/cities.module';
import { UsersModule } from '../users/users.module';
import { LeaderboardSnapshotRepository } from './leaderboard-snapshot.repository';
import { LeaderboardsController } from './leaderboards.controller';
import { LeaderboardsRepository } from './leaderboards.repository';
import { LeaderboardsService } from './leaderboards.service';

/**
 * City leaderboards (Phase 10). `AuthProviderModule` and `UsersModule` are here for
 * `JwtAuthGuard`'s own dependencies, the same two imports every guarded module needs;
 * `UsersModule` also exports the `PrivacyService` the service reads live. `CitiesModule` supplies
 * the slug-to-timezone lookup that dates a city's month.
 */
@Module({
  imports: [AuthProviderModule, UsersModule, CitiesModule],
  controllers: [LeaderboardsController],
  providers: [LeaderboardsService, LeaderboardsRepository, LeaderboardSnapshotRepository],
})
export class LeaderboardsModule {}
