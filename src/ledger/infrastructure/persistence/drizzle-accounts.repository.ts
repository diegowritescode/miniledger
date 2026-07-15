import { and, eq, or } from 'drizzle-orm';
import { type Database } from '../../../db/db.module';
import { Currency } from '../../../shared/kernel/currency';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { Account, type AccountType } from '../../domain/account';
import { AccountId } from '../../domain/account-id';
import { type AccountsRepository } from '../../domain/ports/accounts-repository';
import { accounts } from './accounts.schema';

type AccountRow = typeof accounts.$inferSelect;

export class DrizzleAccountsRepository implements AccountsRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async save(account: Account, tx?: Tx): Promise<void> {
    await this.executor(tx).insert(accounts).values(this.toRow(account));
  }

  async findById(id: AccountId, tx?: Tx): Promise<Account | null> {
    const rows = await this.executor(tx)
      .select()
      .from(accounts)
      .where(eq(accounts.id, id.value))
      .limit(1);
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async findByHandle(handle: string, currency: Currency, tx?: Tx): Promise<Account | null> {
    const rows = await this.executor(tx)
      .select()
      .from(accounts)
      .where(and(eq(accounts.handle, handle), eq(accounts.currency, currency.code)))
      .limit(1);
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async list(tx?: Tx): Promise<Account[]> {
    const rows = await this.executor(tx).select().from(accounts);
    return rows.map((row) => this.toDomain(row));
  }

  async listVisibleTo(ownerId: string, tx?: Tx): Promise<Account[]> {
    const rows = await this.executor(tx)
      .select()
      .from(accounts)
      .where(or(eq(accounts.ownerId, ownerId), eq(accounts.type, 'system')));
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: AccountRow): Account {
    const currency = Currency.of(row.currency);
    if (!currency.ok) {
      throw new Error(`stored account ${row.id} has an unknown currency: ${row.currency}`);
    }
    return Account.reconstitute({
      id: AccountId.fromString(row.id),
      type: row.type as AccountType,
      currency: currency.value,
      overdraftFloor: row.overdraftFloor,
      handle: row.handle,
      ownerId: row.ownerId,
      createdAt: row.createdAt,
    });
  }

  private toRow(account: Account): typeof accounts.$inferInsert {
    return {
      id: account.id.value,
      type: account.type,
      currency: account.currency.code,
      overdraftFloor: account.overdraftFloor,
      handle: account.handle,
      ownerId: account.ownerId,
      createdAt: account.createdAt,
    };
  }
}
