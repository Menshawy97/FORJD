import './instrument';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { applyCors } from './cors';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  applyCors(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  await app.listen(port);
}

void bootstrap();
