import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzleUnitOfWork } from '../../src/db/drizzle-unit-of-work';
import { LedgerPoster } from '../../src/ledger/application/ledger-poster';
import { ReverseService } from '../../src/ledger/application/reverse.service';
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

describe('Reversal (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
  const db = drizzle(pool);
  const accounts = new DrizzleAccountsRepository(db);
  const balances = new DrizzleAccountBalancesRepository(db);
  const journals = new DrizzleJournalTransactionsRepository(db);
  const idempotency = new DrizzleIdempotencyRepository(db);
  const uow = new DrizzleUnitOfWork(db);
  const poster = new LedgerPoster(accounts, balances, journals, new DrizzleOutboxRepository(db));
  const transfers = new TransferService(poster, idempotency, uow);
  const reversals = new ReverseService(journals, poster, uow);

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
    const account = Account.openUser(USD, 'owner-test', new Date('2026-10-10T10:00:00.000Z'));
    await accounts.save(account);
    await balances.initialize(account.id);
    createdAccountIds.push(account.id.value);
    return account.id;
  };

  const transfer = async (from: AccountId, to: AccountId, amount: string): Promise<string> => {
    const result = await transfers.transfer({
      from: from.value,
      to: to.value,
      amount,
      currency: 'USD',
      ownerId: 'owner-test',
    });
    if (!result.ok) throw new Error(`transfer failed: ${result.error}`);
    createdTransactionIds.push(result.value.id);
    return result.value.id;
  };

  it('reverses a transfer, restores balances, and links + emits the compensating entry', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await transfer(worldUsd, a, '1000');
    const transferId = await transfer(a, b, '500');

    expect(await balances.find(a)).toBe(500n);
    expect(await balances.find(b)).toBe(500n);

    const result = await reversals.reverse(transferId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdTransactionIds.push(result.value.id);

    const legs = new Map(
      result.value.postings.map((posting) => [posting.accountId, posting.amount]),
    );
    expect(legs.get(a.value)).toBe('500');
    expect(legs.get(b.value)).toBe('-500');

    expect(await balances.find(a)).toBe(1000n);
    expect(await balances.find(b)).toBe(0n);

    const link = await pool.query<{ reverses_transaction_id: string | null }>(
      'SELECT reverses_transaction_id FROM journal_transactions WHERE id = $1',
      [result.value.id],
    );
    expect(link.rows[0]?.reverses_transaction_id).toBe(transferId);

    const events = await pool.query<{ type: string }>(
      "SELECT type FROM outbox WHERE type = 'transfer.reversed' AND payload->>'id' = $1",
      [result.value.id],
    );
    expect(events.rows).toHaveLength(1);
  });

  it('rejects a second reversal of the same transaction with already_reversed', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await transfer(worldUsd, a, '1000');
    const transferId = await transfer(a, b, '400');

    const first = await reversals.reverse(transferId);
    expect(first.ok).toBe(true);
    if (first.ok) createdTransactionIds.push(first.value.id);

    const second = await reversals.reverse(transferId);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('already_reversed');

    expect(await balances.find(a)).toBe(1000n);
    expect(await balances.find(b)).toBe(0n);
  });

  it('returns unknown_transaction for an id that does not exist', async () => {
    const result = await reversals.reverse('00000000-0000-4000-8000-000000000000');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unknown_transaction');
  });

  it('rejects reversing a transfer whose destination already spent the funds', async () => {
    const a = await openAccount();
    const b = await openAccount();
    const c = await openAccount();
    await transfer(worldUsd, a, '1000');
    const transferId = await transfer(a, b, '500');
    await transfer(b, c, '500');

    expect(await balances.find(b)).toBe(0n);

    const result = await reversals.reverse(transferId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('insufficient_funds');

    expect(await balances.find(a)).toBe(500n);
    expect(await balances.find(b)).toBe(0n);
    expect(await balances.find(c)).toBe(500n);
  });
});
