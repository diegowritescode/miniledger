import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { type Executor } from '../../src/db/db.module';
import { DrizzleUnitOfWork } from '../../src/db/drizzle-unit-of-work';
import { appMeta } from '../../src/db/schema';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5433/miniledger';

describe('DrizzleUnitOfWork (integration)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const uow = new DrizzleUnitOfWork(drizzle(pool));

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE app_meta');
  });

  afterAll(async () => {
    await pool.end();
  });

  const read = async (key: string): Promise<string | undefined> => {
    const result = await pool.query<{ value: string }>(
      'SELECT value FROM app_meta WHERE key = $1',
      [key],
    );
    return result.rows[0]?.value;
  };

  it('commits writes made within the transaction boundary', async () => {
    await uow.withTransaction(async (tx) => {
      const executor = tx.executor as Executor;
      await executor.insert(appMeta).values({ key: 'schema_version', value: '1' });
    });

    expect(await read('schema_version')).toBe('1');
  });

  it('reads its own writes inside the transaction before commit', async () => {
    const seen = await uow.withTransaction(async (tx) => {
      const executor = tx.executor as Executor;
      await executor.insert(appMeta).values({ key: 'seq', value: '7' });
      const rows = await executor.select().from(appMeta).where(eq(appMeta.key, 'seq'));
      return rows[0]?.value;
    });

    expect(seen).toBe('7');
  });

  it('rolls back the whole unit on error, persisting nothing', async () => {
    await expect(
      uow.withTransaction(async (tx) => {
        const executor = tx.executor as Executor;
        await executor.insert(appMeta).values({ key: 'doomed', value: 'x' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await read('doomed')).toBeUndefined();
  });
});
