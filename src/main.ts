import 'reflect-metadata';
import './load-env-file';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV } from './config/env.module';
import type { Env } from './config/env';
import { setupOpenApi } from './openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useBodyParser('json', { limit: '32kb' });
  app.enableShutdownHooks();
  setupOpenApi(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
  Logger.log(`MiniLedger API listening on :${env.PORT}`, 'Bootstrap');
}

void bootstrap();
