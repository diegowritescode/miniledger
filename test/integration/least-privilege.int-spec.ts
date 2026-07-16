import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5433/miniledger';
const APP_PASSWORD = 'least-privilege-int-test';

describe('Least-privilege runtime role (integration)', () => {
  const owner = new Pool({ connectionString: DATABASE_URL });
  let app: Pool;

  beforeAll(async () => {
    await owner.query(`ALTER ROLE miniledger_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);
    const url = new URL(DATABASE_URL);
    url.username = 'miniledger_app';
    url.password = APP_PASSWORD;
    app = new Pool({ connectionString: url.toString() });
  });

  afterAll(async () => {
    await app?.end();
    await owner.query('ALTER ROLE miniledger_app WITH NOLOGIN');
    await owner.end();
  });

  it('may read the ledger history', async () => {
    await expect(app.query('SELECT 1 FROM postings LIMIT 1')).resolves.toBeDefined();
  });

  it('may not UPDATE postings — the append-only REVOKE binds at runtime', async () => {
    await expect(
      app.query('UPDATE postings SET amount = amount WHERE false'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('may not DELETE postings', async () => {
    await expect(app.query('DELETE FROM postings WHERE false')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('may not UPDATE journal_transactions', async () => {
    await expect(
      app.query('UPDATE journal_transactions SET currency = currency WHERE false'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
