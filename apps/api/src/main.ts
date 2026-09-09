import './instrument';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { applyCors } from './cors';

async function bootstrap(): Promise<void> {
  // rawBody: true (Phase 7, WHOOP webhooks) -- HMAC signature verification needs the exact
  // bytes WHOOP sent, not a re-serialized copy of the parsed JSON body. Nest still parses
  // req.body normally for every route; this only additionally exposes req.rawBody.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  applyCors(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  await app.listen(port);
}

void bootstrap();
