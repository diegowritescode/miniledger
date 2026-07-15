import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzleUnitOfWork } from '../../src/db/drizzle-unit-of-work';
import { LedgerPoster } from '../../src/ledger/application/ledger-poster';
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

describe('Transfer idempotency (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
  const db = drizzle(pool);
  const accounts = new DrizzleAccountsRepository(db);
  const balances = new DrizzleAccountBalancesRepository(db);
  const journals = new DrizzleJournalTransactionsRepository(db);
  const idempotency = new DrizzleIdempotencyRepository(db);
  const uow = new DrizzleUnitOfWork(db);
  const poster = new LedgerPoster(accounts, balances, journals, new DrizzleOutboxRepository(db));
  const service = new TransferService(poster, idempotency, uow);

  const createdAccountIds: string[] = [];
  const createdKeys: string[] = [];
  let worldUsd: AccountId;

  beforeAll(async () => {
    const found = await accounts.findByHandle('@world', USD);
    if (!found) throw new Error('@world USD account must be seeded');
    worldUsd = found.id;
  });

  afterEach(async () => {
    if (createdKeys.length > 0) {
      await pool.query('DELETE FROM idempotency_keys WHERE key = ANY($1::text[])', [createdKeys]);
      createdKeys.length = 0;
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
        "UPDATE account_balances SET balance = 0 WHERE account_id IN (SELECT id FROM accounts WHERE handle = '@world')",
      );
      createdAccountIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  const openAccount = async (): Promise<AccountId> => {
    const account = Account.openUser(USD, 'owner-test', new Date('2026-07-07T07:00:00.000Z'));
    await accounts.save(account);
    await balances.initialize(account.id);
    createdAccountIds.push(account.id.value);
    return account.id;
  };

  const key = (): string => {
    const value = randomUUID();
    createdKeys.push(value);
    return value;
  };

  const deposit = async (to: AccountId, amount: bigint): Promise<void> => {
    const result = await service.transfer({
      from: worldUsd.value,
      to: to.value,
      amount: amount.toString(),
      currency: 'USD',
      ownerId: 'owner-test',
    });
    if (!result.ok) throw new Error(`deposit failed: ${result.error}`);
  };

  it('replays the original receipt on retry and moves money only once', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, 1000n);
    const k = key();

    const first = await service.transfer({
      from: a.value,
      to: b.value,
      amount: '250',
      currency: 'USD',
      ownerId: 'owner-test',
      idempotencyKey: k,
    });
    const second = await service.transfer({
      from: a.value,
      to: b.value,
      amount: '250',
      currency: 'USD',
      ownerId: 'owner-test',
      idempotencyKey: k,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.id).toBe(first.value.id);
    expect(await balances.find(b)).toBe(250n);
    expect(await balances.find(a)).toBe(750n);
  });

  it('rejects the same key reused for a different request', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, 1000n);
    const k = key();

    await service.transfer({
      from: a.value,
      to: b.value,
      amount: '100',
      currency: 'USD',
      ownerId: 'owner-test',
      idempotencyKey: k,
    });
    const conflict = await service.transfer({
      from: a.value,
      to: b.value,
      amount: '200',
      currency: 'USD',
      ownerId: 'owner-test',
      idempotencyKey: k,
    });

    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error).toBe('idempotency_conflict');
    expect(await balances.find(b)).toBe(100n);
  });

  it('executes exactly once for two concurrent identical requests', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, 1000n);
    const k = key();

    const [first, second] = await Promise.all([
      service.transfer({
        from: a.value,
        to: b.value,
        amount: '400',
        currency: 'USD',
        ownerId: 'owner-test',
        idempotencyKey: k,
      }),
      service.transfer({
        from: a.value,
        to: b.value,
        amount: '400',
        currency: 'USD',
        ownerId: 'owner-test',
        idempotencyKey: k,
      }),
    ]);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).toBe(second.value.id);
    expect(await balances.find(b)).toBe(400n);
    expect(await balances.find(a)).toBe(600n);
  });

  it('does not persist the key when the transfer fails, so a retry re-attempts', async () => {
    const a = await openAccount();
    const b = await openAccount();
    const k = key();

    const failed = await service.transfer({
      from: a.value,
      to: b.value,
      amount: '100',
      currency: 'USD',
      ownerId: 'owner-test',
      idempotencyKey: k,
    });
    expect(failed.ok).toBe(false);

    const stored = await pool.query('SELECT 1 FROM idempotency_keys WHERE key = $1', [k]);
    expect(stored.rowCount).toBe(0);

    await deposit(a, 500n);
    const retry = await service.transfer({
      from: a.value,
      to: b.value,
      amount: '100',
      currency: 'USD',
      ownerId: 'owner-test',
      idempotencyKey: k,
    });
    expect(retry.ok).toBe(true);
    expect(await balances.find(b)).toBe(100n);
  });
});
