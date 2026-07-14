import { Module } from '@nestjs/common';
import { DB, type Database } from '../db/db.module';
import { CLOCK } from '../shared/kernel/clock';
import { SystemClock } from '../shared/kernel/system-clock';
import { AccountsService } from './application/accounts.service';
import { ACCOUNT_BALANCES_REPOSITORY } from './domain/ports/account-balances-repository';
import { ACCOUNTS_REPOSITORY } from './domain/ports/accounts-repository';
import { JOURNAL_TRANSACTIONS_REPOSITORY } from './domain/ports/journal-transactions-repository';
import { DrizzleAccountBalancesRepository } from './infrastructure/persistence/drizzle-account-balances.repository';
import { DrizzleAccountsRepository } from './infrastructure/persistence/drizzle-accounts.repository';
import { DrizzleJournalTransactionsRepository } from './infrastructure/persistence/drizzle-journal-transactions.repository';
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
    {
      provide: ACCOUNT_BALANCES_REPOSITORY,
      inject: [DB],
      useFactory: (db: Database): DrizzleAccountBalancesRepository =>
        new DrizzleAccountBalancesRepository(db),
    },
    {
      provide: JOURNAL_TRANSACTIONS_REPOSITORY,
      inject: [DB],
      useFactory: (db: Database): DrizzleJournalTransactionsRepository =>
        new DrizzleJournalTransactionsRepository(db),
    },
  ],
})
export class LedgerModule {}
