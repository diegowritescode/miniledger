import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Currency } from '../../src/shared/kernel/currency';
import { Account } from '../../src/ledger/domain/account';
import { DrizzleAccountsRepository } from '../../src/ledger/infrastructure/persistence/drizzle-accounts.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5433/miniledger';

const currency = (code: string): Currency => {
  const result = Currency.of(code);
  if (!result.ok) throw new Error(`unsupported test currency: ${code}`);
  return result.value;
};

describe('DrizzleAccountsRepository (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const repository = new DrizzleAccountsRepository(drizzle(pool));
  const createdAccountIds: string[] = [];

  const persist = async (account: Account): Promise<Account> => {
    await repository.save(account);
    createdAccountIds.push(account.id.value);
    return account;
  };

  afterEach(async () => {
    if (createdAccountIds.length === 0) return;
    await pool.query('DELETE FROM postings WHERE account_id = ANY($1::uuid[])', [
      createdAccountIds,
    ]);
    await pool.query('DELETE FROM account_balances WHERE account_id = ANY($1::uuid[])', [
      createdAccountIds,
    ]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [createdAccountIds]);
    createdAccountIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('saves a user account and reads back an equal aggregate', async () => {
    const account = await persist(
      Account.openUser(currency('USD'), new Date('2026-04-04T10:00:00.000Z')),
    );

    const found = await repository.findById(account.id);

    expect(found).not.toBeNull();
    if (!found) return;
    expect(found.id.equals(account.id)).toBe(true);
    expect(found.type).toBe('user');
    expect(found.currency.code).toBe('USD');
    expect(found.overdraftFloor).toBe(0n);
    expect(found.handle).toBeNull();
    expect(found.createdAt.getTime()).toBe(account.createdAt.getTime());
  });

  it('includes a saved account in the listing', async () => {
    const account = await persist(Account.openUser(currency('EUR'), new Date()));

    const listed = await repository.list();

    expect(listed.some((candidate) => candidate.id.equals(account.id))).toBe(true);
  });

  it('returns null for an unknown id', async () => {
    const missing = Account.openUser(currency('USD'), new Date());

    expect(await repository.findById(missing.id)).toBeNull();
  });

  it.each(['USD', 'EUR', 'JPY'])(
    'exposes the seeded @world system account for %s',
    async (code) => {
      const world = await repository.findByHandle('@world', currency(code));

      expect(world).not.toBeNull();
      if (!world) return;
      expect(world.type).toBe('system');
      expect(world.isSystem()).toBe(true);
      expect(world.isOverdraftExempt()).toBe(true);
      expect(world.overdraftFloor).toBeNull();
      expect(world.currency.code).toBe(code);
    },
  );

  it('returns null when no account matches the handle for a currency', async () => {
    expect(await repository.findByHandle('@nobody', currency('USD'))).toBeNull();
  });
});
