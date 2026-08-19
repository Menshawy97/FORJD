import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AuthProviderModule } from './auth-provider.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [AuthProviderModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
