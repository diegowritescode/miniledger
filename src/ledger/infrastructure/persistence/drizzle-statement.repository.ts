import { and, asc, eq, gt } from 'drizzle-orm';
import { type Database } from '../../../db/db.module';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type AccountId } from '../../domain/account-id';
import {
  type StatementEntry,
  type StatementRepository,
} from '../../domain/ports/statement-repository';
import { postings } from './journal-transactions.schema';

export class DrizzleStatementRepository implements StatementRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async page(
    accountId: AccountId,
    limit: number,
    afterSeq: number | null,
    tx?: Tx,
  ): Promise<StatementEntry[]> {
    const scope = eq(postings.accountId, accountId.value);
    const where = afterSeq === null ? scope : and(scope, gt(postings.seq, afterSeq));
    const rows = await this.executor(tx)
      .select({
        seq: postings.seq,
        transactionId: postings.transactionId,
        amount: postings.amount,
        balanceAfter: postings.balanceAfter,
        createdAt: postings.createdAt,
      })
      .from(postings)
      .where(where)
      .orderBy(asc(postings.seq))
      .limit(limit);
    return rows.map((row) => ({
      seq: row.seq,
      transactionId: row.transactionId,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      createdAt: row.createdAt,
    }));
  }
}
