import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { DB, type Database } from '../db/db.module';
import { CLOCK } from '../shared/kernel/clock';
import { SystemClock } from '../shared/kernel/system-clock';
import { AccountsService } from './application/accounts.service';
import { AuditService } from './application/audit.service';
import { TransferService } from './application/transfer.service';
import { ACCOUNT_BALANCES_REPOSITORY } from './domain/ports/account-balances-repository';
import { ACCOUNTS_REPOSITORY } from './domain/ports/accounts-repository';
import { AUDIT_REPOSITORY } from './domain/ports/audit-repository';
import { IDEMPOTENCY_REPOSITORY } from './domain/ports/idempotency-repository';
import { JOURNAL_TRANSACTIONS_REPOSITORY } from './domain/ports/journal-transactions-repository';
import { OUTBOX_REPOSITORY } from './domain/ports/outbox-repository';
import { DrizzleAccountBalancesRepository } from './infrastructure/persistence/drizzle-account-balances.repository';
import { DrizzleAccountsRepository } from './infrastructure/persistence/drizzle-accounts.repository';
import { DrizzleAuditRepository } from './infrastructure/persistence/drizzle-audit.repository';
import { DrizzleIdempotencyRepository } from './infrastructure/persistence/drizzle-idempotency.repository';
import { DrizzleJournalTransactionsRepository } from './infrastructure/persistence/drizzle-journal-transactions.repository';
import { DrizzleOutboxRepository } from './infrastructure/persistence/drizzle-outbox.repository';
import { AccountsController } from './interface/accounts.controller';
import { AuditController } from './interface/audit.controller';
import { TransfersController } from './interface/transfers.controller';

@Module({
  imports: [AccessModule],
  controllers: [AccountsController, TransfersController, AuditController],
  providers: [
    AccountsService,
    TransferService,
    AuditService,
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
    {
      provide: OUTBOX_REPOSITORY,
      inject: [DB],
      useFactory: (db: Database): DrizzleOutboxRepository => new DrizzleOutboxRepository(db),
    },
    {
      provide: IDEMPOTENCY_REPOSITORY,
      inject: [DB],
      useFactory: (db: Database): DrizzleIdempotencyRepository =>
        new DrizzleIdempotencyRepository(db),
    },
    {
      provide: AUDIT_REPOSITORY,
      inject: [DB],
      useFactory: (db: Database): DrizzleAuditRepository => new DrizzleAuditRepository(db),
    },
  ],
})
export class LedgerModule {}
