import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './common/health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
        // Body paths are listed even though bodies are not logged today: the moment
        // anyone enables body logging, credentials must already be covered.
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'res.body.accessToken',
          'res.body.refreshToken',
        ],
      },
    }),
    // Auth endpoints are unauthenticated by nature and sit in front of a third party,
    // so they need a limiter of their own rather than relying on Supabase's.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    StorageModule,
  ],
  // Registering ThrottlerModule alone does nothing — the guard has to be bound, or the
  // @Throttle decorators on AuthController are inert decoration.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
