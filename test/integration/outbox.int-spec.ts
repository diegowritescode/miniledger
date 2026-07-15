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
import { DrizzleOutboxRepository } from '../../src/ledger/infrastructure/persistence/drizzle-outbox.repository';
import { Currency } from '../../src/shared/kernel/currency';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5433/miniledger';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('USD must be supported');
  return result.value;
})();

interface OutboxRow {
  id: string;
  type: string;
  payload: { id: string; currency: string; postings: unknown[] };
  published_at: string | null;
}

describe('Transactional outbox (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
  const db = drizzle(pool);
  const accounts = new DrizzleAccountsRepository(db);
  const balances = new DrizzleAccountBalancesRepository(db);
  const journals = new DrizzleJournalTransactionsRepository(db);
  const idempotency = new DrizzleIdempotencyRepository(db);
  const uow = new DrizzleUnitOfWork(db);
  const service = new TransferService(
    accounts,
    balances,
    journals,
    idempotency,
    new DrizzleOutboxRepository(db),
    uow,
  );

  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];
  let worldUsd: AccountId;

  beforeAll(async () => {
    const found = await accounts.findByHandle('@world', USD);
    if (!found) throw new Error('@world USD account must be seeded');
    worldUsd = found.id;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await pool.query("DELETE FROM outbox WHERE payload->>'id' = ANY($1::text[])", [
        createdTransactionIds,
      ]);
    }
    if (createdAccountIds.length > 0) {
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
    }
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  const openAccount = async (): Promise<AccountId> => {
    const account = Account.openUser(USD, 'owner-test', new Date('2026-09-09T09:00:00.000Z'));
    await accounts.save(account);
    await balances.initialize(account.id);
    createdAccountIds.push(account.id.value);
    return account.id;
  };

  const outboxFor = async (transactionId: string): Promise<OutboxRow[]> => {
    const result = await pool.query<OutboxRow>(
      "SELECT id, type, payload, published_at FROM outbox WHERE type = 'transfer.posted' AND payload->>'id' = $1",
      [transactionId],
    );
    return result.rows;
  };

  it('writes a transfer.posted event atomically with a successful transfer', async () => {
    const a = await openAccount();
    const result = await service.transfer({
      from: worldUsd.value,
      to: a.value,
      amount: '500',
      currency: 'USD',
      ownerId: 'owner-test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdTransactionIds.push(result.value.id);

    const rows = await outboxFor(result.value.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('transfer.posted');
    expect(rows[0]?.published_at).toBeNull();
    expect(rows[0]?.payload.currency).toBe('USD');
    expect(rows[0]?.payload.postings).toHaveLength(2);
  });

  it('writes no event when the transfer fails (rolled back with the money)', async () => {
    const a = await openAccount();
    const b = await openAccount();

    const before = await pool.query<{ count: string }>('SELECT count(*)::text FROM outbox');

    const result = await service.transfer({
      from: a.value,
      to: b.value,
      amount: '100',
      currency: 'USD',
      ownerId: 'owner-test',
    });
    expect(result.ok).toBe(false);

    const after = await pool.query<{ count: string }>('SELECT count(*)::text FROM outbox');
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
