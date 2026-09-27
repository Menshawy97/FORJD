import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CitiesModule } from '../cities/cities.module';
import { ForgeModule } from '../forge/forge.module';
import { LeaderboardsModule } from '../leaderboards/leaderboards.module';
import { UsersModule } from '../users/users.module';
import { AthleteStatsRepository } from './athlete-stats.repository';
import { AthletesController } from './athletes.controller';
import { AthletesService } from './athletes.service';

@Module({
  imports: [AuthProviderModule, UsersModule, LeaderboardsModule, CitiesModule, ForgeModule],
  controllers: [AthletesController],
  providers: [AthletesService, AthleteStatsRepository, JwtAuthGuard],
})
export class AthletesModule {}
