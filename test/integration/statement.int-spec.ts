import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { StatementService } from '../../src/ledger/application/statement.service';
import { Account } from '../../src/ledger/domain/account';
import { type AccountId } from '../../src/ledger/domain/account-id';
import { DrizzleAccountBalancesRepository } from '../../src/ledger/infrastructure/persistence/drizzle-account-balances.repository';
import { DrizzleAccountsRepository } from '../../src/ledger/infrastructure/persistence/drizzle-accounts.repository';
import { DrizzleStatementRepository } from '../../src/ledger/infrastructure/persistence/drizzle-statement.repository';
import { Currency } from '../../src/shared/kernel/currency';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5433/miniledger';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('USD must be supported');
  return result.value;
})();

describe('Account statement (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  const db = drizzle(pool);
  const accounts = new DrizzleAccountsRepository(db);
  const balances = new DrizzleAccountBalancesRepository(db);
  const statementRepo = new DrizzleStatementRepository(db);
  const service = new StatementService(accounts, statementRepo);

  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await pool.query('DELETE FROM postings WHERE transaction_id = ANY($1::uuid[])', [
        createdTransactionIds,
      ]);
      await pool.query('DELETE FROM journal_transactions WHERE id = ANY($1::uuid[])', [
        createdTransactionIds,
      ]);
    }
    if (createdAccountIds.length > 0) {
      await pool.query('DELETE FROM account_balances WHERE account_id = ANY($1::uuid[])', [
        createdAccountIds,
      ]);
      await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [createdAccountIds]);
    }
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  const openAccount = async (ownerId: string): Promise<AccountId> => {
    const account = Account.openUser(USD, ownerId, new Date('2026-07-07T07:00:00.000Z'));
    await accounts.save(account);
    await balances.initialize(account.id);
    createdAccountIds.push(account.id.value);
    return account.id;
  };

  const seedPostings = async (
    accountId: AccountId,
    counterId: AccountId,
    amounts: number[],
  ): Promise<void> => {
    const client = await pool.connect();
    try {
      for (const amount of amounts) {
        await client.query('BEGIN');
        const tx = await client.query<{ id: string }>(
          "INSERT INTO journal_transactions (currency) VALUES ('USD') RETURNING id",
        );
        const transactionId = tx.rows[0]?.id;
        if (!transactionId) throw new Error('failed to seed a transaction');
        createdTransactionIds.push(transactionId);
        await client.query(
          'INSERT INTO postings (transaction_id, account_id, amount, balance_after, hash) VALUES ($1, $2, $3, $4, $5)',
          [transactionId, accountId.value, amount, amount, `a-${transactionId}`],
        );
        await client.query(
          'INSERT INTO postings (transaction_id, account_id, amount, balance_after, hash) VALUES ($1, $2, $3, $4, $5)',
          [transactionId, counterId.value, -amount, -amount, `b-${transactionId}`],
        );
        await client.query('COMMIT');
      }
    } finally {
      client.release();
    }
  };

  it('pages an account history in seq order with a cursor', async () => {
    const account = await openAccount('owner-test');
    const counter = await openAccount('owner-test');
    await seedPostings(account, counter, [100, -30, -20]);

    const first = await statementRepo.page(account, 2, null);
    expect(first.map((entry) => entry.amount)).toEqual([100n, -30n]);
    expect(first).toHaveLength(2);

    const cursor = first[1]?.seq ?? null;
    const second = await statementRepo.page(account, 2, cursor);
    expect(second.map((entry) => entry.amount)).toEqual([-20n]);
  });

  it('returns an owner-scoped statement with a next cursor, and hides non-owners', async () => {
    const account = await openAccount('owner-test');
    const counter = await openAccount('owner-test');
    await seedPostings(account, counter, [100, -30, -20]);

    const owned = await service.forAccount(account.value, 'owner-test', 2, null);
    expect(owned).not.toBeNull();
    expect(owned?.entries).toHaveLength(2);
    expect(owned?.nextCursor).not.toBeNull();

    expect(await service.forAccount(account.value, 'someone-else', 2, null)).toBeNull();
  });
});
