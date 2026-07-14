import { asc, eq, sql } from 'drizzle-orm';
import { type Database } from '../../../db/db.module';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type AccountId } from '../../domain/account-id';
import {
  type AuditAccountState,
  type AuditPosting,
  type AuditRepository,
} from '../../domain/ports/audit-repository';
import { accountBalances } from './account-balances.schema';
import { journalTransactions, postings } from './journal-transactions.schema';

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async postingsForAccount(accountId: AccountId, tx?: Tx): Promise<AuditPosting[]> {
    const rows = await this.executor(tx)
      .select({
        seq: postings.seq,
        transactionId: postings.transactionId,
        accountId: postings.accountId,
        amount: postings.amount,
        balanceAfter: postings.balanceAfter,
        prevHash: postings.prevHash,
        hash: postings.hash,
      })
      .from(postings)
      .where(eq(postings.accountId, accountId.value))
      .orderBy(asc(postings.seq));
    return rows.map((row) => ({
      seq: row.seq,
      transactionId: row.transactionId,
      accountId: row.accountId,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      prevHash: row.prevHash,
      hash: row.hash,
    }));
  }

  async accountState(accountId: AccountId, tx?: Tx): Promise<AuditAccountState | null> {
    const rows = await this.executor(tx)
      .select({ balance: accountBalances.balance, chainHash: accountBalances.chainHash })
      .from(accountBalances)
      .where(eq(accountBalances.accountId, accountId.value))
      .limit(1);
    const row = rows[0];
    return row ? { balance: row.balance, chainHash: row.chainHash } : null;
  }

  async conservationByCurrency(tx?: Tx): Promise<Map<string, bigint>> {
    const rows = await this.executor(tx)
      .select({
        currency: journalTransactions.currency,
        total: sql<string>`sum(${postings.amount})`,
      })
      .from(postings)
      .innerJoin(journalTransactions, eq(journalTransactions.id, postings.transactionId))
      .groupBy(journalTransactions.currency);
    return new Map<string, bigint>(rows.map((row) => [row.currency, BigInt(row.total)]));
  }
}
