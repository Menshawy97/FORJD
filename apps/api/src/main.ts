import './instrument';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { applyCors } from './cors';
import { configureTrustProxy } from './trust-proxy';

async function bootstrap(): Promise<void> {
  // rawBody: true (Phase 7, WHOOP webhooks) -- HMAC signature verification needs the exact
  // bytes WHOOP sent, not a re-serialized copy of the parsed JSON body. Nest still parses
  // req.body normally for every route; this only additionally exposes req.rawBody.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  configureTrustProxy(app);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  configureApp(app);
  applyCors(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  await app.listen(port);
}

void bootstrap();
