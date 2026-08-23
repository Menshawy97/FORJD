import { Module } from '@nestjs/common';

import { AuthProviderModule } from '../auth/auth-provider.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';
import { AthletesController } from './athletes.controller';
import { AthletesService } from './athletes.service';

@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [AthletesController],
  providers: [AthletesService, JwtAuthGuard],
})
export class AthletesModule {}
