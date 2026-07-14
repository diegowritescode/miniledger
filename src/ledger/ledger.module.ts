import { Module } from '@nestjs/common';
import { DB, type Database } from '../db/db.module';
import { CLOCK } from '../shared/kernel/clock';
import { SystemClock } from '../shared/kernel/system-clock';
import { AccountsService } from './application/accounts.service';
import { ACCOUNTS_REPOSITORY } from './domain/ports/accounts-repository';
import { DrizzleAccountsRepository } from './infrastructure/persistence/drizzle-accounts.repository';
import { AccountsController } from './interface/accounts.controller';

@Module({
  controllers: [AccountsController],
  providers: [
    AccountsService,
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: ACCOUNTS_REPOSITORY,
      inject: [DB],
      useFactory: (db: Database): DrizzleAccountsRepository => new DrizzleAccountsRepository(db),
    },
  ],
})
export class LedgerModule {}
