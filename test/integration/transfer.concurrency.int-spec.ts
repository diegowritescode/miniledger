import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzleUnitOfWork } from '../../src/db/drizzle-unit-of-work';
import { TransferService } from '../../src/ledger/application/transfer.service';
import { Account } from '../../src/ledger/domain/account';
import { type AccountId } from '../../src/ledger/domain/account-id';
import { DrizzleAccountBalancesRepository } from '../../src/ledger/infrastructure/persistence/drizzle-account-balances.repository';
import { DrizzleAccountsRepository } from '../../src/ledger/infrastructure/persistence/drizzle-accounts.repository';
import { DrizzleIdempotencyRepository } from '../../src/ledger/infrastructure/persistence/drizzle-idempotency.repository';
import { DrizzleJournalTransactionsRepository } from '../../src/ledger/infrastructure/persistence/drizzle-journal-transactions.repository';
import { Currency } from '../../src/shared/kernel/currency';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5433/miniledger';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('USD must be supported');
  return result.value;
})();

describe('Transfer concurrency (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });
  const db = drizzle(pool);
  const accounts = new DrizzleAccountsRepository(db);
  const balances = new DrizzleAccountBalancesRepository(db);
  const journals = new DrizzleJournalTransactionsRepository(db);
  const idempotency = new DrizzleIdempotencyRepository(db);
  const uow = new DrizzleUnitOfWork(db);
  const service = new TransferService(accounts, balances, journals, idempotency, uow);

  const createdAccountIds: string[] = [];
  let worldUsd: AccountId;

  beforeAll(async () => {
    const found = await accounts.findByHandle('@world', USD);
    if (!found) throw new Error('@world USD account must be seeded');
    worldUsd = found.id;
  });

  afterEach(async () => {
    if (createdAccountIds.length === 0) return;
    await pool.query(
      'DELETE FROM postings WHERE account_id = ANY($1::uuid[]) OR transaction_id IN (SELECT transaction_id FROM postings WHERE account_id = ANY($1::uuid[]))',
      [createdAccountIds],
    );
    await pool.query(
      'DELETE FROM journal_transactions jt WHERE NOT EXISTS (SELECT 1 FROM postings p WHERE p.transaction_id = jt.id)',
    );
    await pool.query('DELETE FROM account_balances WHERE account_id = ANY($1::uuid[])', [
      createdAccountIds,
    ]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [createdAccountIds]);
    await pool.query(
      "UPDATE account_balances SET balance = 0 WHERE account_id IN (SELECT id FROM accounts WHERE handle = '@world')",
    );
    createdAccountIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  const openAccount = async (): Promise<AccountId> => {
    const account = Account.openUser(USD, new Date('2026-06-06T06:00:00.000Z'));
    await accounts.save(account);
    await balances.initialize(account.id);
    createdAccountIds.push(account.id.value);
    return account.id;
  };

  const deposit = async (to: AccountId, amount: bigint): Promise<void> => {
    const result = await service.transfer({
      from: worldUsd.value,
      to: to.value,
      amount: amount.toString(),
      currency: 'USD',
    });
    if (!result.ok) throw new Error(`deposit failed: ${result.error}`);
  };

  const sumOfPostings = async (accountId: AccountId): Promise<bigint> => {
    const result = await pool.query<{ total: string | null }>(
      'SELECT COALESCE(SUM(amount), 0)::text AS total FROM postings WHERE account_id = $1',
      [accountId.value],
    );
    return BigInt(result.rows[0]?.total ?? '0');
  };

  it('applies K concurrent transfers with no lost update and exact balances', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, 1000n);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.transfer({ from: a.value, to: b.value, amount: '10', currency: 'USD' }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);

    expect(await balances.find(a)).toBe(800n);
    expect(await balances.find(b)).toBe(200n);
    expect(await sumOfPostings(a)).toBe(800n);
    expect(await sumOfPostings(b)).toBe(200n);
  });

  it('never overdraws a floored account under a concurrent overdraft race (no write-skew)', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, 100n);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.transfer({ from: a.value, to: b.value, amount: '30', currency: 'USD' }),
      ),
    );

    const succeeded = results.filter((result) => result.ok).length;
    expect(succeeded).toBe(3);

    const balanceA = await balances.find(a);
    const balanceB = await balances.find(b);
    expect(balanceA).toBe(10n);
    expect(balanceB).toBe(90n);
    expect(balanceA! >= 0n).toBe(true);
  });

  it('is deadlock-free under opposing concurrent transfer directions', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, 500n);
    await deposit(b, 500n);

    const results = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        service.transfer({ from: a.value, to: b.value, amount: '5', currency: 'USD' }),
      ),
      ...Array.from({ length: 10 }, () =>
        service.transfer({ from: b.value, to: a.value, amount: '5', currency: 'USD' }),
      ),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect((await balances.find(a))! + (await balances.find(b))!).toBe(1000n);
  });
});
