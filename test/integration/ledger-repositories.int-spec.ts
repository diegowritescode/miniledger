import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzleUnitOfWork } from '../../src/db/drizzle-unit-of-work';
import { AccountsService } from '../../src/ledger/application/accounts.service';
import { Account } from '../../src/ledger/domain/account';
import { AccountId } from '../../src/ledger/domain/account-id';
import { JournalTransaction } from '../../src/ledger/domain/journal-transaction';
import { DrizzleAccountBalancesRepository } from '../../src/ledger/infrastructure/persistence/drizzle-account-balances.repository';
import { DrizzleAccountsRepository } from '../../src/ledger/infrastructure/persistence/drizzle-accounts.repository';
import { DrizzleJournalTransactionsRepository } from '../../src/ledger/infrastructure/persistence/drizzle-journal-transactions.repository';
import { type Clock } from '../../src/shared/kernel/clock';
import { Currency } from '../../src/shared/kernel/currency';
import { Money } from '../../src/shared/kernel/money';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5433/miniledger';

const currency = (code: string): Currency => {
  const result = Currency.of(code);
  if (!result.ok) throw new Error(`unsupported test currency: ${code}`);
  return result.value;
};

describe('Ledger repositories (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);
  const accounts = new DrizzleAccountsRepository(db);
  const balances = new DrizzleAccountBalancesRepository(db);
  const journals = new DrizzleJournalTransactionsRepository(db);
  const uow = new DrizzleUnitOfWork(db);
  const clock: Clock = { now: () => new Date('2026-05-05T12:00:00.000Z') };

  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  const persistAccount = async (code: string): Promise<Account> => {
    const account = Account.openUser(currency(code), 'owner-test', clock.now());
    await accounts.save(account);
    createdAccountIds.push(account.id.value);
    return account;
  };

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await pool.query('DELETE FROM postings WHERE transaction_id = ANY($1::uuid[])', [
        createdTransactionIds,
      ]);
      await pool.query('DELETE FROM journal_transactions WHERE id = ANY($1::uuid[])', [
        createdTransactionIds,
      ]);
      createdTransactionIds.length = 0;
    }
    if (createdAccountIds.length > 0) {
      await pool.query('DELETE FROM account_balances WHERE account_id = ANY($1::uuid[])', [
        createdAccountIds,
      ]);
      await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [createdAccountIds]);
      createdAccountIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('AccountBalancesRepository', () => {
    it('round-trips a balance through initialize, find, and updateBalance', async () => {
      const account = await persistAccount('USD');

      await balances.initialize(account.id);
      expect(await balances.find(account.id)).toBe(0n);

      await balances.updateBalance(account.id, 2500n, 'chain-head');
      expect(await balances.find(account.id)).toBe(2500n);
    });

    it('returns null when no balance row exists for the account', async () => {
      expect(await balances.find(AccountId.generate())).toBeNull();
    });
  });

  describe('JournalTransactionsRepository', () => {
    it('appends a balanced journal transaction with a matching balance_after per posting', async () => {
      const debit = await persistAccount('USD');
      const credit = await persistAccount('USD');

      const built = JournalTransaction.transfer(
        debit.id,
        credit.id,
        Money.of(100n, currency('USD')),
      );
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const journal = built.value;
      createdTransactionIds.push(journal.id.value);

      await uow.withTransaction((tx) =>
        journals.append(
          journal,
          [
            { balanceAfter: -100n, prevHash: null, hash: 'hash-debit' },
            { balanceAfter: 100n, prevHash: null, hash: 'hash-credit' },
          ],
          tx,
        ),
      );

      const header = await pool.query<{ currency: string }>(
        'SELECT currency FROM journal_transactions WHERE id = $1',
        [journal.id.value],
      );
      expect(header.rows).toHaveLength(1);
      expect(header.rows[0]?.currency).toBe('USD');

      const postings = await pool.query<{
        account_id: string;
        amount: string;
        balance_after: string;
      }>(
        'SELECT account_id, amount, balance_after FROM postings WHERE transaction_id = $1 ORDER BY amount',
        [journal.id.value],
      );
      expect(postings.rows).toHaveLength(2);
      const [debitLeg, creditLeg] = postings.rows;
      if (!debitLeg || !creditLeg) throw new Error('expected two posting rows');
      expect(debitLeg.account_id).toBe(debit.id.value);
      expect(debitLeg.amount).toBe('-100');
      expect(debitLeg.balance_after).toBe('-100');
      expect(creditLeg.account_id).toBe(credit.id.value);
      expect(creditLeg.amount).toBe('100');
      expect(creditLeg.balance_after).toBe('100');
    });

    it('rejects a balanceAfter array whose length does not match the postings', async () => {
      const built = JournalTransaction.transfer(
        AccountId.generate(),
        AccountId.generate(),
        Money.of(100n, currency('USD')),
      );
      if (!built.ok) throw new Error('unreachable');

      await expect(
        journals.append(built.value, [{ balanceAfter: 100n, prevHash: null, hash: 'h' }]),
      ).rejects.toThrow(/lines/);
    });
  });

  describe('opening an account', () => {
    it('initializes an account_balances row when an account is opened via AccountsService', async () => {
      const service = new AccountsService(accounts, balances, uow, clock);

      const result = await service.open({ currency: 'USD', ownerId: 'owner-test' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdAccountIds.push(result.value.id.value);

      expect(await balances.find(result.value.id)).toBe(0n);

      const rows = await pool.query<{ balance: string }>(
        'SELECT balance FROM account_balances WHERE account_id = $1',
        [result.value.id.value],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.balance).toBe('0');
    });
  });
});
