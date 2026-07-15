import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzleUnitOfWork } from '../../src/db/drizzle-unit-of-work';
import { AuditService } from '../../src/ledger/application/audit.service';
import { TransferService } from '../../src/ledger/application/transfer.service';
import { Account } from '../../src/ledger/domain/account';
import { type AccountId } from '../../src/ledger/domain/account-id';
import { DrizzleAccountBalancesRepository } from '../../src/ledger/infrastructure/persistence/drizzle-account-balances.repository';
import { DrizzleAccountsRepository } from '../../src/ledger/infrastructure/persistence/drizzle-accounts.repository';
import { DrizzleAuditRepository } from '../../src/ledger/infrastructure/persistence/drizzle-audit.repository';
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

describe('Audit verifier (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
  const db = drizzle(pool);
  const accounts = new DrizzleAccountsRepository(db);
  const balances = new DrizzleAccountBalancesRepository(db);
  const journals = new DrizzleJournalTransactionsRepository(db);
  const idempotency = new DrizzleIdempotencyRepository(db);
  const auditRepo = new DrizzleAuditRepository(db);
  const uow = new DrizzleUnitOfWork(db);
  const transfers = new TransferService(
    accounts,
    balances,
    journals,
    idempotency,
    new DrizzleOutboxRepository(db),
    uow,
  );
  const audit = new AuditService(accounts, auditRepo);

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
    const account = Account.openUser(USD, 'owner-test', new Date('2026-08-08T08:00:00.000Z'));
    await accounts.save(account);
    await balances.initialize(account.id);
    createdAccountIds.push(account.id.value);
    return account.id;
  };

  const transfer = async (from: AccountId, to: AccountId, amount: string): Promise<void> => {
    const result = await transfers.transfer({
      from: from.value,
      to: to.value,
      amount,
      currency: 'USD',
      ownerId: 'owner-test',
    });
    if (!result.ok) throw new Error(`transfer failed: ${result.error}`);
  };

  it('verifies a funded account chain, head, reconciliation, and global conservation', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await transfer(worldUsd, a, '1000');
    await transfer(a, b, '300');
    await transfer(a, b, '200');

    const report = await audit.verifyAccount(a.value);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value).toEqual({
      accountId: a.value,
      postingCount: 3,
      balance: 500n,
      chainValid: true,
      headMatches: true,
      reconciled: true,
      brokenAtSeq: null,
    });

    const conservation = await audit.verifyConservation();
    expect(conservation.conserved).toBe(true);
    expect(conservation.byCurrency.every((entry) => entry.total === 0n)).toBe(true);
  });

  it('detects an owner-level UPDATE that REVOKE cannot prevent', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await transfer(worldUsd, a, '1000');
    await transfer(a, b, '300');

    const before = await audit.verifyAccount(a.value);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.chainValid).toBe(true);
    expect(before.value.reconciled).toBe(true);

    const target = await pool.query<{ seq: string }>(
      'SELECT seq::text FROM postings WHERE account_id = $1 ORDER BY seq LIMIT 1',
      [a.value],
    );
    const tamperedSeq = Number(target.rows[0]?.seq);
    const updated = await pool.query(
      'UPDATE postings SET amount = amount + 1 WHERE account_id = $1 AND seq = $2',
      [a.value, tamperedSeq],
    );
    expect(updated.rowCount).toBe(1);

    const after = await audit.verifyAccount(a.value);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.chainValid).toBe(false);
    expect(after.value.brokenAtSeq).toBe(tamperedSeq);
    expect(after.value.reconciled).toBe(false);
  });
});
