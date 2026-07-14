import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzleUnitOfWork } from '../../src/db/drizzle-unit-of-work';
import { TransferService } from '../../src/ledger/application/transfer.service';
import { Account } from '../../src/ledger/domain/account';
import { type AccountId } from '../../src/ledger/domain/account-id';
import { hashPosting } from '../../src/ledger/domain/hash-chain';
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

interface PostingRow {
  seq: string;
  transaction_id: string;
  account_id: string;
  amount: string;
  balance_after: string;
  prev_hash: string | null;
  hash: string;
}

describe('Posting hash chain (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
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
      'DELETE FROM postings WHERE transaction_id IN (SELECT transaction_id FROM postings WHERE account_id = ANY($1::uuid[]))',
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
      "UPDATE account_balances SET balance = 0, chain_hash = NULL WHERE account_id IN (SELECT id FROM accounts WHERE handle = '@world')",
    );
    createdAccountIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  const openAccount = async (): Promise<AccountId> => {
    const account = Account.openUser(USD, new Date('2026-08-08T08:00:00.000Z'));
    await accounts.save(account);
    await balances.initialize(account.id);
    createdAccountIds.push(account.id.value);
    return account.id;
  };

  const transfer = async (from: AccountId, to: AccountId, amount: string): Promise<void> => {
    const result = await service.transfer({
      from: from.value,
      to: to.value,
      amount,
      currency: 'USD',
    });
    if (!result.ok) throw new Error(`transfer failed: ${result.error}`);
  };

  const postingsFor = async (accountId: AccountId): Promise<PostingRow[]> => {
    const result = await pool.query<PostingRow>(
      'SELECT seq::text, transaction_id, account_id, amount::text, balance_after::text, prev_hash, hash FROM postings WHERE account_id = $1 ORDER BY seq',
      [accountId.value],
    );
    return result.rows;
  };

  const chainHead = async (accountId: AccountId): Promise<string | null> => {
    const result = await pool.query<{ chain_hash: string | null }>(
      'SELECT chain_hash FROM account_balances WHERE account_id = $1',
      [accountId.value],
    );
    return result.rows[0]?.chain_hash ?? null;
  };

  it('links each posting to its predecessor and matches the recomputed hash', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await transfer(worldUsd, a, '1000');
    await transfer(a, b, '300');
    await transfer(a, b, '200');

    const rows = await postingsFor(a);
    expect(rows).toHaveLength(3);

    let prev: string | null = null;
    for (const row of rows) {
      expect(row.prev_hash).toBe(prev);
      const recomputed = hashPosting(prev, {
        transactionId: row.transaction_id,
        accountId: row.account_id,
        amount: BigInt(row.amount),
        balanceAfter: BigInt(row.balance_after),
      });
      expect(row.hash).toBe(recomputed);
      prev = row.hash;
    }

    expect(await chainHead(a)).toBe(prev);
  });

  it('gives each account an independent chain', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await transfer(worldUsd, a, '500');
    await transfer(a, b, '100');

    const aRows = await postingsFor(a);
    const bRows = await postingsFor(b);
    expect(aRows).toHaveLength(2);
    expect(bRows).toHaveLength(1);
    expect(bRows[0]?.prev_hash).toBeNull();
    expect(await chainHead(b)).toBe(bRows[0]?.hash);
  });
});
