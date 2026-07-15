import { asc, eq } from 'drizzle-orm';
import { type Database } from '../../../db/db.module';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type JournalTransaction } from '../../domain/journal-transaction';
import {
  type JournalTransactionsRepository,
  type OriginalTransaction,
  type PostingLine,
} from '../../domain/ports/journal-transactions-repository';
import { journalTransactions, postings } from './journal-transactions.schema';

export class DrizzleJournalTransactionsRepository implements JournalTransactionsRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async append(
    journal: JournalTransaction,
    lines: readonly PostingLine[],
    tx?: Tx,
    reversesTransactionId?: string,
  ): Promise<void> {
    if (lines.length !== journal.postings.length) {
      throw new Error(
        `lines has ${lines.length} entries but the transaction has ${journal.postings.length} postings`,
      );
    }

    const executor = this.executor(tx);
    await executor
      .insert(journalTransactions)
      .values(this.toTransactionRow(journal, reversesTransactionId));
    await executor.insert(postings).values(this.toPostingRows(journal, lines));
  }

  async findById(id: string, tx?: Tx): Promise<OriginalTransaction | null> {
    const executor = this.executor(tx);
    const transactionRows = await executor
      .select({ currency: journalTransactions.currency })
      .from(journalTransactions)
      .where(eq(journalTransactions.id, id))
      .limit(1);
    const transactionRow = transactionRows[0];
    if (!transactionRow) return null;

    const postingRows = await executor
      .select({ accountId: postings.accountId, amount: postings.amount })
      .from(postings)
      .where(eq(postings.transactionId, id))
      .orderBy(asc(postings.seq));
    return {
      currency: transactionRow.currency,
      postings: postingRows.map((row) => ({ accountId: row.accountId, amount: row.amount })),
    };
  }

  async hasReversal(transactionId: string, tx?: Tx): Promise<boolean> {
    const rows = await this.executor(tx)
      .select({ id: journalTransactions.id })
      .from(journalTransactions)
      .where(eq(journalTransactions.reversesTransactionId, transactionId))
      .limit(1);
    return rows.length > 0;
  }

  private toTransactionRow(
    journal: JournalTransaction,
    reversesTransactionId?: string,
  ): typeof journalTransactions.$inferInsert {
    return {
      id: journal.id.value,
      currency: journal.currency.code,
      reversesTransactionId: reversesTransactionId ?? null,
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
