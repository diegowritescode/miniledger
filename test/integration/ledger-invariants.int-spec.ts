import { Pool } from 'pg';
import { Currency } from '../../src/shared/kernel/currency';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5433/miniledger';

const INSERT_POSTING =
  "INSERT INTO postings (transaction_id, account_id, amount, balance_after, hash) VALUES ($1, $2, $3, $4, 'test-hash')";

describe('Ledger DB-enforced invariants (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  const createUserAccount = async (currencyCode = 'USD'): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      "INSERT INTO accounts (type, currency, overdraft_floor) VALUES ('user', $1, 0) RETURNING id",
      [currencyCode],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to create a test account');
    createdAccountIds.push(row.id);
    return row.id;
  };

  const startTransaction = async (currencyCode = 'USD'): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      'INSERT INTO journal_transactions (currency) VALUES ($1) RETURNING id',
      [currencyCode],
    );
    const row = result.rows[0];
    if (!row) throw new Error('failed to create a test transaction');
    createdTransactionIds.push(row.id);
    return row.id;
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

  it('accepts a balanced multi-leg transaction whose legs are inserted one at a time', async () => {
    const debit = await createUserAccount('USD');
    const credit = await createUserAccount('USD');
    const transactionId = await startTransaction('USD');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(INSERT_POSTING, [transactionId, debit, -100, -100]);
      await client.query(INSERT_POSTING, [transactionId, credit, 100, 100]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const postings = await pool.query<{ amount: string; balance_after: string }>(
      'SELECT amount, balance_after FROM postings WHERE transaction_id = $1 ORDER BY amount',
      [transactionId],
    );
    expect(postings.rows).toHaveLength(2);
    expect(postings.rows.map((row) => row.amount)).toEqual(['-100', '100']);
  });

  it('rejects an unbalanced transaction at COMMIT while the mid-transaction inserts succeed', async () => {
    const debit = await createUserAccount('USD');
    const credit = await createUserAccount('USD');
    const transactionId = await startTransaction('USD');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(INSERT_POSTING, [transactionId, debit, -100, -100]),
      ).resolves.toBeDefined();
      await expect(
        client.query(INSERT_POSTING, [transactionId, credit, 50, 50]),
      ).resolves.toBeDefined();
      await expect(client.query('COMMIT')).rejects.toThrow(/unbalanced/);
    } finally {
      client.release();
    }

    const persisted = await pool.query('SELECT 1 FROM postings WHERE transaction_id = $1', [
      transactionId,
    ]);
    expect(persisted.rowCount).toBe(0);
  });

  it('rejects a zero-amount posting immediately via the CHECK constraint', async () => {
    const account = await createUserAccount('USD');
    const transactionId = await startTransaction('USD');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(INSERT_POSTING, [transactionId, account, 0, 0])).rejects.toThrow(
        /postings_amount_nonzero/,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('has an account_balances row for every account after migration, including @world', async () => {
    const missing = await pool.query<{ id: string }>(
      `SELECT a.id
       FROM accounts a
       LEFT JOIN account_balances ab ON ab.account_id = a.id
       WHERE ab.account_id IS NULL`,
    );
    expect(missing.rows).toHaveLength(0);

    const worlds = await pool.query<{ account_id: string; balance_rows: number }>(
      `SELECT ab.account_id, COUNT(*)::int AS balance_rows
       FROM account_balances ab
       JOIN accounts a ON a.id = ab.account_id
       WHERE a.handle = '@world'
       GROUP BY ab.account_id`,
    );
    expect(worlds.rows).toHaveLength(Currency.codes().length);
    worlds.rows.forEach((row) => expect(row.balance_rows).toBe(1));
  });
});
