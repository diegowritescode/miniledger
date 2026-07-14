import { type Database } from '../../../db/db.module';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type JournalTransaction } from '../../domain/journal-transaction';
import { type JournalTransactionsRepository } from '../../domain/ports/journal-transactions-repository';
import { journalTransactions, postings } from './journal-transactions.schema';

export class DrizzleJournalTransactionsRepository implements JournalTransactionsRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async append(
    journal: JournalTransaction,
    balanceAfter: readonly bigint[],
    tx?: Tx,
  ): Promise<void> {
    if (balanceAfter.length !== journal.postings.length) {
      throw new Error(
        `balanceAfter has ${balanceAfter.length} entries but the transaction has ${journal.postings.length} postings`,
      );
    }

    const executor = this.executor(tx);
    await executor.insert(journalTransactions).values(this.toTransactionRow(journal));
    await executor.insert(postings).values(this.toPostingRows(journal, balanceAfter));
  }

  private toTransactionRow(journal: JournalTransaction): typeof journalTransactions.$inferInsert {
    return {
      id: journal.id.value,
      currency: journal.currency.code,
    };
  }

  private toPostingRows(
    journal: JournalTransaction,
    balanceAfter: readonly bigint[],
  ): (typeof postings.$inferInsert)[] {
    return journal.postings.map((posting, index) => ({
      transactionId: journal.id.value,
      accountId: posting.accountId.value,
      amount: posting.amount.amount,
      balanceAfter: balanceAfter[index]!,
    }));
  }
}
