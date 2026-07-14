import { eq, sql } from 'drizzle-orm';
import { type Database } from '../../../db/db.module';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type AccountId } from '../../domain/account-id';
import {
  type AccountBalancesRepository,
  type LockedBalance,
} from '../../domain/ports/account-balances-repository';
import { accountBalances } from './account-balances.schema';

export class DrizzleAccountBalancesRepository implements AccountBalancesRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async initialize(accountId: AccountId, tx?: Tx): Promise<void> {
    await this.executor(tx)
      .insert(accountBalances)
      .values({ accountId: accountId.value, balance: 0n });
  }

  async find(accountId: AccountId, tx?: Tx): Promise<bigint | null> {
    const rows = await this.executor(tx)
      .select({ balance: accountBalances.balance })
      .from(accountBalances)
      .where(eq(accountBalances.accountId, accountId.value))
      .limit(1);
    const row = rows[0];
    return row ? row.balance : null;
  }

  async updateBalance(
    accountId: AccountId,
    balance: bigint,
    chainHash: string | null,
    tx?: Tx,
  ): Promise<void> {
    await this.executor(tx)
      .update(accountBalances)
      .set({ balance, chainHash, updatedAt: sql`now()` })
      .where(eq(accountBalances.accountId, accountId.value));
  }

  async lockForUpdate(
    accountIds: readonly AccountId[],
    tx: Tx,
  ): Promise<Map<string, LockedBalance>> {
    const ordered = [...new Set(accountIds.map((id) => id.value))].sort();
    const balances = new Map<string, LockedBalance>();
    for (const id of ordered) {
      const rows = await this.executor(tx)
        .select({ balance: accountBalances.balance, chainHash: accountBalances.chainHash })
        .from(accountBalances)
        .where(eq(accountBalances.accountId, id))
        .for('update');
      const row = rows[0];
      if (!row) throw new Error(`account ${id} has no balance row to lock`);
      balances.set(id, { balance: row.balance, chainHash: row.chainHash });
    }
    return balances;
  }
}
