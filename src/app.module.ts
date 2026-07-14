import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { EnvModule } from './config/env.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { ProblemDetailsFilter } from './shared/http/problem-details.filter';

@Module({
  imports: [EnvModule, DbModule, HealthModule, LedgerModule],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
