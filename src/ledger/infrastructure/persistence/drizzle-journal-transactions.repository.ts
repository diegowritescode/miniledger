import { type Database } from '../../../db/db.module';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type JournalTransaction } from '../../domain/journal-transaction';
import {
  type JournalTransactionsRepository,
  type PostingLine,
} from '../../domain/ports/journal-transactions-repository';
import { journalTransactions, postings } from './journal-transactions.schema';

export class DrizzleJournalTransactionsRepository implements JournalTransactionsRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async append(journal: JournalTransaction, lines: readonly PostingLine[], tx?: Tx): Promise<void> {
    if (lines.length !== journal.postings.length) {
      throw new Error(
        `lines has ${lines.length} entries but the transaction has ${journal.postings.length} postings`,
      );
    }

    const executor = this.executor(tx);
    await executor.insert(journalTransactions).values(this.toTransactionRow(journal));
    await executor.insert(postings).values(this.toPostingRows(journal, lines));
  }

  private toTransactionRow(journal: JournalTransaction): typeof journalTransactions.$inferInsert {
    return {
      id: journal.id.value,
      currency: journal.currency.code,
    };
  }

  private toPostingRows(
    journal: JournalTransaction,
    lines: readonly PostingLine[],
  ): (typeof postings.$inferInsert)[] {
    return journal.postings.map((posting, index) => {
      const line = lines[index]!;
      return {
        transactionId: journal.id.value,
        accountId: posting.accountId.value,
        amount: posting.amount.amount,
        balanceAfter: line.balanceAfter,
        prevHash: line.prevHash,
        hash: line.hash,
      };
    });
  }
}
